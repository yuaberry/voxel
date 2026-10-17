//! Briefing documents — the owner's ask: users bring their OWN files
//! (.txt, .md, .pdf, .docx — the formats Google Drive/Docs ships) and the
//! app turns them into project/server briefings the agent actually reads.
//!
//! Extraction is REAL per format:
//!  - .txt / .md: the bytes are the text
//!  - .docx: a zip we unzip, pulling the text runs out of word/document.xml
//!  - .pdf: text extracted with the pdf-extract crate
//! Nothing is faked: a file we cannot read says so.

use serde::Serialize;
use std::io::Read as _;
use std::path::Path;

const MAX_SOURCE_BYTES: u64 = 25 * 1024 * 1024; // 25 MB per document
const MAX_TEXT_CHARS: usize = 400_000; // extracted text cap (~most of a book)

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDoc {
    pub file_name: String,
    pub kind: String, // txt | md | pdf | docx
    pub text: String,
}

fn sanitize_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    stem.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect::<String>()
        .trim()
        .to_string()
}

fn extract_txt(bytes: &[u8]) -> Result<String, String> {
    let text = String::from_utf8_lossy(bytes).to_string();
    Ok(text
        .chars()
        .take(MAX_TEXT_CHARS)
        .collect::<String>()
        .trim()
        .to_string())
}

fn xml_entity(name: &str) -> String {
    // The ampersand arrives by code point so the source never contains a
    // complete entity literal — it survives every pipeline that decodes.
    format!("{}{}{}", char::from_u32(0x26).unwrap(), name, ';')
}

fn unescape_xml(s: &str) -> String {
    // entity -> character; the bare ampersand replacement runs LAST
    s.replace(&xml_entity("lt"), "<")
        .replace(&xml_entity("gt"), ">")
        .replace(&xml_entity("quot"), "\"")
        .replace(&xml_entity("apos"), "'")
        .replace(&xml_entity("amp"), &(char::from_u32(0x26).unwrap().to_string()))
}

/// DOCX = zip with word/document.xml. Text lives in <w:t> runs; paragraphs
/// end at </w:p>; <w:br/> and <w:tab/> break lines. A tiny, honest reader —
/// no XML crate needed for well-formed Word output.
fn extract_docx(bytes: &[u8]) -> Result<String, String> {
    let cursor = std::io::Cursor::new(bytes.to_vec());
    let mut zip = zip::ZipArchive::new(cursor).map_err(|e| format!("not a valid .docx (zip): {e}"))?;
    let mut xml = String::new();
    {
        let mut entry = zip
            .by_name("word/document.xml")
            .map_err(|e| format!("docx is missing word/document.xml: {e}"))?;
        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|e| format!("docx read: {e}"))?;
        xml = buf;
    }
    let mut out = String::new();
    let mut rest = xml.as_str();
    while let Some(start) = rest.find('<') {
        // plain text before the next tag
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let end = after
            .find('>')
            .ok_or_else(|| "malformed docx xml".to_string())?;
        let tag = &after[..=end];
        if tag.starts_with("<w:t") {
            // text run: keep whatever comes until </w:t>
            let chunk = &after[end + 1..];
            let close = chunk.find("</w:t>").unwrap_or(chunk.len());
            out.push_str(&unescape_xml(&chunk[..close]));
            rest = &chunk[close..];
            continue;
        }
        if tag.starts_with("</w:p") {
            out.push('\n');
        } else if tag.contains("w:br") || tag.contains("w:tab") {
            out.push('\n');
        }
        rest = &after[end + 1..];
    }
    let text = out.trim().to_string();
    if text.is_empty() {
        return Err("the docx has no extractable text (maybe it is only images?)".to_string());
    }
    Ok(text.chars().take(MAX_TEXT_CHARS).collect())
}

fn extract_pdf(bytes: &[u8]) -> Result<String, String> {
    let text = pdf_extract::extract_text_from_mem(bytes)
        .map_err(|e| format!("pdf text extraction failed: {e}"))?;
    let cleaned = text.trim().to_string();
    if cleaned.is_empty() {
        return Err("the pdf has no extractable text (scanned images only?)".to_string());
    }
    Ok(cleaned.chars().take(MAX_TEXT_CHARS).collect())
}

/// Extracts the text of ONE user file (already picked by the OS dialog on
/// the JS side). Runs off the main thread in the command wrapper.
pub fn extract_document_impl(file_path: String) -> Result<ExtractedDoc, String> {
    let path = Path::new(&file_path);
    let meta = std::fs::metadata(path).map_err(|e| format!("cannot read the file: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".to_string());
    }
    if meta.len() > MAX_SOURCE_BYTES {
        return Err(format!(
            "document is {} MB — the limit is {} MB",
            meta.len() / (1024 * 1024),
            MAX_SOURCE_BYTES / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read failed: {e}"))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".to_string());
    let lower = name.to_ascii_lowercase();
    let (kind, text) = if lower.ends_with(".txt") {
        ("txt", extract_txt(&bytes)?)
    } else if lower.ends_with(".md") {
        ("md", extract_txt(&bytes)?)
    } else if lower.ends_with(".docx") {
        ("docx", extract_docx(&bytes)?)
    } else if lower.ends_with(".pdf") {
        ("pdf", extract_pdf(&bytes)?)
    } else {
        return Err(format!(
            "unsupported file \"{name}\" — bring .txt, .md, .pdf or .docx (the formats Google Drive ships)"
        ));
    };
    Ok(ExtractedDoc {
        file_name: name,
        kind: kind.to_string(),
        text,
    })
}

#[tauri::command]
pub async fn documents_extract(file_path: String) -> Result<ExtractedDoc, String> {
    // docx unzips and pdfs parse — real work, off the main thread
    tauri::async_runtime::spawn_blocking(move || extract_document_impl(file_path))
        .await
        .map_err(|e| format!("worker failed: {e}"))?
}

/// Persists an extracted briefing as readable markdown next to the
/// project/server it belongs to (`<rel_dir>/<stem>.brief.md`), returning the
/// path. Path-guarded: rel_dir must stay inside the workspace.
#[tauri::command]
pub fn documents_write(
    base_path: String,
    rel_dir: String,
    file_name: String,
    kind: String,
    text: String,
) -> Result<String, String> {
    use super::fs::validated_path;
    if rel_dir.contains("..") {
        return Err("Path traversal is not allowed".to_string());
    }
    // Materialize the folder tree first — validated_path(allow_missing)
    // requires an existing parent, and briefings land several levels deep.
    let raw_dir = std::path::Path::new(&base_path).join(&rel_dir);
    std::fs::create_dir_all(&raw_dir).map_err(|e| format!("create briefing folder: {e}"))?;
    let target_dir = validated_path(&base_path, &rel_dir, true)?;
    let stem = sanitize_stem(&file_name);
    if stem.is_empty() {
        return Err("empty document name".to_string());
    }
    let target = target_dir.join(format!("{stem}.brief.md"));
    let body = format!(
        "# Briefing: {stem}\n\n> imported from `{file_name}` ({kind}) by VOXEL {}\n\n```\n{}\n```\n",
        env!("CARGO_PKG_VERSION"),
        text.trim()
    );
    std::fs::write(&target, body).map_err(|e| format!("{e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("voxel-docs-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn txt_and_md_extract_directly() {
        let dir = temp_dir("txt");
        let p = dir.join("notes.txt");
        std::fs::write(&p, b"my prison server idea: mine to earn").unwrap();
        let doc = extract_document_impl(p.to_string_lossy().to_string()).unwrap();
        assert_eq!(doc.kind, "txt");
        assert!(doc.text.contains("prison server idea"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsupported_files_are_refused_honestly() {
        let dir = temp_dir("bad");
        let p = dir.join("virus.exe");
        std::fs::write(&p, b"MZ").unwrap();
        let err = extract_document_impl(p.to_string_lossy().to_string()).unwrap_err();
        assert!(err.contains("Google Drive"), "must tell which formats ARE accepted: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn docx_text_runs_extract_with_paragraph_breaks() {
        // a REAL minimal docx, built with the zip crate exactly like Word does
        let dir = temp_dir("docx");
        let p = dir.join("spec.docx");
        let xml = format!(
            "<w:document><w:body>             <w:p><w:r><w:t>Rank </w:t></w:r><w:r><w:t>UP</w:t></w:r></w:p>             <w:p><w:r><w:t>Cell {amp} mine</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>line2</w:t></w:r></w:p>             </w:body></w:document>",
            amp = xml_entity("amp"),
        );
        let file = std::fs::File::create(&p).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut zip, xml.as_bytes()).unwrap();
        zip.finish().unwrap();

        let doc = extract_document_impl(p.to_string_lossy().to_string()).unwrap();
        assert_eq!(doc.kind, "docx");
        assert!(doc.text.contains("Rank UP"), "runs concatenate: {}", doc.text);
        assert!(doc.text.contains("Cell & mine"), "xml entities unescape");
        assert!(doc.text.contains('\n'), "paragraphs break lines");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_real_pdf_extracts_its_text() {
        // a REAL minimal PDF (uncompressed Helvetica text object, exactly
        // the classic hello-world layout) — if the extractor can't read
        // this, it can't read anything
        let dir = temp_dir("pdf");
        let p = dir.join("brief.pdf");
        let content = b"BT /F1 24 Tf 72 700 Td (VOXEL briefing from pdf) Tj ET";
        let mut pdf = String::new();
        pdf.push_str("%PDF-1.4\n");
        let mut offsets: Vec<usize> = Vec::new();
        let mut push_obj = |pdf: &mut String, offsets: &mut Vec<usize>, id: usize, body: &str| {
            offsets.push(pdf.len());
            pdf.push_str(&format!("{id} 0 obj\n{body}\nendobj\n"));
        };
        push_obj(&mut pdf, &mut offsets, 1, "<< /Type /Catalog /Pages 2 0 R >>");
        push_obj(&mut pdf, &mut offsets, 2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
        push_obj(
            &mut pdf,
            &mut offsets,
            3,
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        );
        let stream_body = format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), String::from_utf8_lossy(content));
        push_obj(&mut pdf, &mut offsets, 4, &stream_body);
        push_obj(&mut pdf, &mut offsets, 5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
        let xref_at = pdf.len();
        pdf.push_str(&format!("xref\n0 {}\n", offsets.len() + 1));
        pdf.push_str("0000000000 65535 f \n");
        for off in &offsets {
            pdf.push_str(&format!("{off:010} 00000 n \n"));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            offsets.len() + 1,
            xref_at
        ));
        std::fs::write(&p, pdf).unwrap();

        let doc = extract_document_impl(p.to_string_lossy().to_string()).unwrap();
        assert_eq!(doc.kind, "pdf");
        assert!(
            doc.text.to_ascii_lowercase().contains("voxel briefing from pdf"),
            "the extractor must read real text: {:?}",
            doc.text
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn documents_write_lands_inside_the_workspace() {
        let dir = temp_dir("write");
        let out = documents_write(
            dir.to_string_lossy().to_string(),
            "projects/kingdom/.voxel/briefing".to_string(),
            "My Design (v2).pdf".to_string(),
            "pdf".to_string(),
            "make the castle GREAT".to_string(),
        )
        .unwrap();
        let target = std::path::PathBuf::from(&out);
        assert!(target.starts_with(&dir), "must stay inside the base");
        let content = std::fs::read_to_string(&target).unwrap();
        assert!(content.contains("# Briefing: My Design _v2"), "title carries the sanitized stem: {content}");
        assert!(content.contains("> imported from `My Design (v2).pdf` (pdf)"), "the ORIGINAL file name is kept: {content}");
        assert!(content.contains("make the castle GREAT"));
        // traversal is refused
        let err = documents_write(
            dir.to_string_lossy().to_string(),
            "../escape".to_string(),
            "x.txt".to_string(),
            "txt".to_string(),
            "x".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("traversal"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
