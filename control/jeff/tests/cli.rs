//! Integration tests for the minimal `jeff` CLI front door (#179).
//!
//! Contract: bare invocation, `--help`/`-h`, and `--version`/`-V` are success
//! paths that print Usage or the crate version. Drove via the built binary
//! (`assert_cmd`), not bats.

use assert_cmd::Command;
use std::process::Output;

fn run(args: &[&str]) -> Output {
    let mut cmd = Command::cargo_bin("jeff").expect("jeff binary built by cargo test");
    cmd.args(args);
    cmd.output().expect("run jeff")
}

fn stdout_utf8(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn bare_jeff_prints_usage_and_succeeds() {
    let out = run(&[]);
    assert!(out.status.success(), "bare jeff exit: {:?}", out.status);
    let text = stdout_utf8(&out);
    assert!(
        text.contains("Usage"),
        "bare jeff must print help until multi-pane exists; stdout was:\n{text}"
    );
}

#[test]
fn help_long_flag_prints_usage_and_succeeds() {
    let out = run(&["--help"]);
    assert!(out.status.success(), "--help exit: {:?}", out.status);
    let text = stdout_utf8(&out);
    assert!(
        text.contains("Usage"),
        "--help missing Usage; stdout was:\n{text}"
    );
}

#[test]
fn help_short_flag_prints_usage_and_succeeds() {
    let out = run(&["-h"]);
    assert!(out.status.success(), "-h exit: {:?}", out.status);
    let text = stdout_utf8(&out);
    assert!(
        text.contains("Usage"),
        "-h missing Usage; stdout was:\n{text}"
    );
}

#[test]
fn version_long_flag_prints_crate_version_and_succeeds() {
    let version = env!("CARGO_PKG_VERSION");
    let out = run(&["--version"]);
    assert!(out.status.success(), "--version exit: {:?}", out.status);
    let text = stdout_utf8(&out);
    assert!(
        text.contains(version),
        "--version missing {version}; stdout was:\n{text}"
    );
}

#[test]
fn version_short_flag_prints_crate_version_and_succeeds() {
    let version = env!("CARGO_PKG_VERSION");
    let out = run(&["-V"]);
    assert!(out.status.success(), "-V exit: {:?}", out.status);
    let text = stdout_utf8(&out);
    assert!(
        text.contains(version),
        "-V missing {version}; stdout was:\n{text}"
    );
}
