#pragma once
#include <string>

// Update-manifest signature verification (ECDSA P-256, CNG/BCrypt).
//
// The manifest (version.json) carries a base64 "sig" field: an ECDSA P-256
// signature over SHA256 of a canonical digest of the files map. The canonical
// digest is, for each file ordinal-sorted by path: "<path>\n<sha256>\n".
// New-VersionJson.ps1 produces it with the private key; the embedded public key
// (update_pubkey.h) verifies it here before any file is downloaded.

// True if the manifest carries a non-empty "sig" field.
bool update_manifest_is_signed(const std::string& manifest);

// Verify the manifest's "sig" against the embedded public key.
// Returns true only if the signature is present AND valid.
bool update_verify_manifest(const std::string& manifest);
