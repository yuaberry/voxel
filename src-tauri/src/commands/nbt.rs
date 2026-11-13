//! NBT — the minimal subset the Minecraft formats need.
//!
//! One implementation, shared by every writer: the structure files
//! (`.nbt`) and the multiplayer server list (`servers.dat`). The bytes
//! are the vanilla ones — a root `TAG_Compound` with an empty name,
//! gzipped the way the client expects.

use std::io::Write;

pub const TAG_BYTE: u8 = 1;
pub const TAG_INT: u8 = 3;
pub const TAG_STRING: u8 = 8;
pub const TAG_LIST: u8 = 9;
pub const TAG_COMPOUND: u8 = 10;

/// Writes one named tag: the type byte, the name and the value.
pub fn write_named<W: Write>(
    out: &mut W,
    tag: u8,
    name: &str,
    value: &[u8],
) -> Result<(), String> {
    let mut head = Vec::new();
    head.push(tag);
    let name_bytes = name.as_bytes();
    if name_bytes.len() > u16::MAX as usize {
        return Err(format!(
            "NBT tag name is {} bytes — the u16 length prefix only fits {}",
            name_bytes.len(),
            u16::MAX
        ));
    }
    head.extend_from_slice(&(name_bytes.len() as u16).to_be_bytes());
    head.extend_from_slice(name_bytes);
    out.write_all(&head).map_err(|e| format!("nbt head: {e}"))?;
    out.write_all(value).map_err(|e| format!("nbt body: {e}"))?;
    Ok(())
}

/// Writes a NBT String tag in JAVA MODIFIED UTF-8 — the encoding the
/// vanilla client reads with `DataInput.readUTF()` (the reader of
/// `servers.dat`, structures and every other NBT it parses).
///
/// Plain UTF-8 is NOT the same thing, and the difference breaks the
/// client:
///
/// * a character **above U+FFFF** (emoji) is **4 bytes** in UTF-8 but a
///   **6-byte surrogate pair** in modified UTF-8 — and `readUTF` rejects
///   the 4-byte form outright with `UTFDataFormatException`;
/// * `U+0000` is `0xC0 0x80` in modified UTF-8.
///
/// Proven with the official code: feeding the plain-UTF-8 bytes of
/// `"Mine Rank 🎮"` to `DataInputStream.readUTF` throws
/// `UTFDataFormatException: malformed input around byte 10`, and the
/// bytes this function writes are byte-identical to Java's own
/// `DataOutputStream.writeUTF`.
///
/// The consequence of the old code was the OWNER'S BUG by a second
/// route: the client threw, discarded the whole `servers.dat` in
/// silence and the Multiplayer screen came up EMPTY — "I cannot join
/// any server", this time with no wrong format at all.
pub fn nbt_string(s: &str) -> Result<Vec<u8>, String> {
    let mut payload = Vec::with_capacity(2 + s.len());
    // `chars()` keeps Rust's guarantee of valid Unicode, so we only ever
    // meet paired/absent surrogates — never an unpaired one.
    for ch in s.chars() {
        let cp = ch as u32;
        if cp > 0xFFFF {
            // supplementary plane: write the surrogate PAIR, 3 bytes each
            let shifted = cp - 0x10000;
            for unit in [0xD800 + (shifted >> 10), 0xDC00 + (shifted & 0x3FF)] {
                push_modified(&mut payload, unit);
            }
        } else {
            push_modified(&mut payload, cp);
        }
    }
    if payload.len() > (u16::MAX as usize) {
        return Err(format!(
            "NBT string is {} bytes — the u16 length prefix only fits {}",
            payload.len(),
            u16::MAX
        ));
    }
    let mut out = Vec::with_capacity(2 + payload.len());
    out.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    out.extend_from_slice(&payload);
    Ok(out)
}

/// Writes one UTF-16 code unit as Java modified UTF-8.
fn push_modified(out: &mut Vec<u8>, unit: u32) {
    if unit == 0 {
        out.extend_from_slice(&[0xC0, 0x80]);
    } else if unit < 0x80 {
        out.push(unit as u8);
    } else if unit < 0x800 {
        out.push((0xC0 | (unit >> 6)) as u8);
        out.push((0x80 | (unit & 0x3F)) as u8);
    } else {
        out.push((0xE0 | (unit >> 12)) as u8);
        out.push((0x80 | ((unit >> 6) & 0x3F)) as u8);
        out.push((0x80 | (unit & 0x3F)) as u8);
    }
}

pub fn nbt_byte(v: u8) -> Vec<u8> {
    vec![v]
}

pub fn nbt_int(v: i32) -> Vec<u8> {
    v.to_be_bytes().to_vec()
}

pub fn nbt_int_list(values: &[i32]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(TAG_INT);
    out.extend_from_slice(&(values.len() as i32).to_be_bytes());
    for v in values {
        out.extend_from_slice(&v.to_be_bytes());
    }
    out
}

/// A generic compound list: each entry is a Vec<(name, tag, value_bytes)>.
pub fn nbt_compound_list(entries: &[Vec<(String, u8, Vec<u8>)>]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(TAG_COMPOUND);
    out.extend_from_slice(&(entries.len() as i32).to_be_bytes());
    for entry in entries {
        for (name, tag, value) in entry {
            let _ = write_named(&mut out, *tag, name, value);
        }
        // TAG_End
        out.push(0u8);
    }
    out
}

/// A compound body — the entries plus the closing `TAG_End`.
pub fn nbt_compound(entries: Vec<(String, u8, Vec<u8>)>) -> Vec<u8> {
    let mut out = Vec::new();
    for (name, tag, value) in entries {
        let _ = write_named(&mut out, tag, &name, &value);
    }
    out.push(0u8); // TAG_End
    out
}

/// The vanilla root: a `TAG_Compound` with an empty name.
pub fn nbt_root(body: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 3);
    out.push(TAG_COMPOUND);
    out.extend_from_slice(&0u16.to_be_bytes()); // empty root name
    out.extend_from_slice(&body);
    out
}

/// Gzip — the vanilla expects gzip'd NBT on disk.
pub fn gzip_bytes(nbt: &[u8]) -> Result<Vec<u8>, String> {
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(nbt).map_err(|e| format!("gzip: {e}"))?;
    gz.finish().map_err(|e| format!("gzip finish: {e}"))
}

#[cfg(test)]
mod nbt_tests {
    use super::*;

    #[test]
    fn a_string_tag_carries_its_length_and_the_bytes() {
        let bytes = nbt_string("Mine Rank").expect("a plain name must encode");
        assert_eq!(bytes.len(), 2 + 9);
        assert_eq!(&bytes[0..2], &9u16.to_be_bytes());
        assert_eq!(&bytes[2..], b"Mine Rank");
    }

    /// The owner's bug II: a name with a character above U+FFFF.
    ///
    /// Plain UTF-8 writes U+1F3AE in 4 bytes and the vanilla client's
    /// `DataInput.readUTF` REJECTS them (UTFDataFormatException) — the
    /// whole file is discarded in silence and the Multiplayer screen
    /// comes up EMPTY. Java modified UTF-8 writes the surrogate pair,
    /// 6 bytes.
    ///
    /// These bytes are byte-identical to Java's own
    /// `DataOutputStream.writeUTF("Mine Rank 🎮")` (verified against the
    /// JDK: payload 16 bytes, tail `ED A0 BC ED BE AE`).
    #[test]
    fn a_supplementary_character_is_the_modified_utf8_the_client_expects() {
        let bytes = nbt_string("Mine Rank \u{1F3AE}").expect("a supplementary plane char must encode");
        // "Mine Rank " (10 bytes) + the surrogate pair (3 + 3 bytes)
        assert_eq!(bytes.len(), 2 + 16);
        assert_eq!(&bytes[0..2], &16u16.to_be_bytes());
        assert_eq!(&bytes[2..12], b"Mine Rank ");
        // U+1F3AE → surrogate pair U+D83C U+DFAE → ED A0 BC ED BE AE
        assert_eq!(&bytes[12..18], &[0xED, 0xA0, 0xBC, 0xED, 0xBE, 0xAE]);
    }

    /// U+0000 is 0xC0 0x80 in modified UTF-8 — the "modified" in the name.
    /// Verified against `DataOutputStream.writeUTF("a\0b")`: payload 4 bytes.
    #[test]
    fn the_null_character_is_the_modified_pair() {
        let bytes = nbt_string("a\u{0}b").expect("a NUL must encode");
        assert_eq!(bytes, vec![0, 4, b'a', 0xC0, 0x80, b'b']);
    }

    /// Accents live in the BMP, where both encodings agree — this is why
    /// the bug hid for so long. "Servidor do Açaí" is 18 bytes in either.
    #[test]
    fn accented_names_are_untouched() {
        let bytes = nbt_string("Servidor do Açaí").expect("an accented name must encode");
        assert_eq!(bytes[0..2], 18u16.to_be_bytes());
        assert_eq!(&bytes[2..], "Servidor do Açaí".as_bytes());
    }

    #[test]
    fn a_compound_closes_with_tag_end() {
        let body = nbt_compound(vec![("port".to_string(), TAG_INT, nbt_int(25565))]);
        assert_eq!(body[body.len() - 1], 0u8);
    }

    #[test]
    fn the_root_is_a_compound_with_an_empty_name() {
        let root = nbt_root(nbt_compound(vec![]));
        assert_eq!(root[0], TAG_COMPOUND);
        assert_eq!(&root[1..3], &0u16.to_be_bytes());
    }
}
