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
    head.extend_from_slice(&(name_bytes.len() as u16).to_be_bytes());
    head.extend_from_slice(name_bytes);
    out.write_all(&head).map_err(|e| format!("nbt head: {e}"))?;
    out.write_all(value).map_err(|e| format!("nbt body: {e}"))?;
    Ok(())
}

pub fn nbt_string(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(2 + b.len());
    out.extend_from_slice(&(b.len() as u16).to_be_bytes());
    out.extend_from_slice(b);
    out
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
        let bytes = nbt_string("Mine Rank");
        assert_eq!(bytes.len(), 2 + 9);
        assert_eq!(&bytes[0..2], &9u16.to_be_bytes());
        assert_eq!(&bytes[2..], b"Mine Rank");
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
