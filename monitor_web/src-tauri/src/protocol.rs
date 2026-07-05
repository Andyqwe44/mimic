// protocol.rs — re-exports shared protocol/protocol.rs into the crate module tree.
// The shared file lives at the repo root so C++ and Python can also reference it.
include!("../../../protocol/protocol.rs");
