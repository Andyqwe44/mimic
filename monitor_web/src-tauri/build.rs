use std::process::Command;

fn main() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.join("..").join("..");
    let capture_dir = project_root.join("capture");

    // Build C++ capture library (GDI methods + WGC) using MSVC
    let build_script = capture_dir.join("build_capture_lib.cmd");
    if build_script.exists() {
        let status = Command::new("cmd")
            .args(["/c", build_script.to_str().unwrap()])
            .current_dir(&capture_dir)
            .status();
        match status {
            Ok(s) if s.success() => {
                println!("cargo:warning=Capture C++ lib compiled OK");
                let build_dir = capture_dir.join("build");
                println!("cargo:rustc-link-search=native={}", build_dir.display());
                println!("cargo:rustc-link-lib=static=capture_lib");
            }
            Ok(s) => {
                println!("cargo:warning=Capture build script failed with exit {}", s.code().unwrap_or(-1));
            }
            Err(e) => {
                println!("cargo:warning=Capture build script error: {}", e);
            }
        }
    }

    // System libs needed by the capture library
    println!("cargo:rustc-link-lib=d3d11");
    println!("cargo:rustc-link-lib=dxgi");
    println!("cargo:rustc-link-lib=windowsapp");
    println!("cargo:rustc-link-lib=user32");
    println!("cargo:rustc-link-lib=gdi32");

    tauri_build::build()
}
