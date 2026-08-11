use assert_cmd::cargo::CommandCargoExt;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use tempfile::TempDir;

pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const TEST_DEADLINE: Duration = Duration::from_secs(10);

pub struct Fixture {
    _root: TempDir,
    pub home: PathBuf,
    pub socket: PathBuf,
    pub project: PathBuf,
    pub other_project: PathBuf,
    pub fake_cook: PathBuf,
    pub fake_bin: PathBuf,
    pub response: PathBuf,
    pub stderr: PathBuf,
    pub exit_code: PathBuf,
    pub log: PathBuf,
    child: Option<Child>,
    socket_override: bool,
}

impl Fixture {
    pub fn new(socket_override: bool) -> Self {
        let root = tempfile::tempdir().expect("create isolated fixture root");
        let home = root.path().join("home");
        let jeff_home = home.join(".jeff");
        let project = root.path().join("project-a");
        let other_project = root.path().join("project-b");
        let fake_bin = root.path().join("bin");
        let socket_root = root.path().join("socket-root");
        for directory in [
            &jeff_home,
            &project.join(".jeff"),
            &other_project.join(".jeff"),
            &fake_bin,
            &socket_root,
        ] {
            fs::create_dir_all(directory).expect("create fixture directory");
        }
        fs::set_permissions(&jeff_home, fs::Permissions::from_mode(0o700))
            .expect("make HOME registry directory private");
        fs::set_permissions(&socket_root, fs::Permissions::from_mode(0o700))
            .expect("make socket directory private");

        let fake_cook = fake_bin.join("fake-cook");
        write_executable(&fake_cook, FAKE_COOK);
        fs::copy(&fake_cook, fake_bin.join("cook")).expect("install PATH cook fake");

        let response = root.path().join("snapshot.json");
        let stderr = root.path().join("cook.stderr");
        let exit_code = root.path().join("cook.exit");
        let log = root.path().join("cook.log");
        fs::write(&response, snapshot("2026-08-10T10:00:00Z", "first"))
            .expect("write initial snapshot");
        fs::write(&stderr, "").expect("write empty stderr fixture");
        fs::write(&exit_code, "0\n").expect("write successful exit fixture");
        fs::write(&log, "").expect("create invocation log");

        let socket = if socket_override {
            socket_root.join("jeffd.sock")
        } else {
            jeff_home.join("jeffd.sock")
        };

        Self {
            _root: root,
            home,
            socket,
            project,
            other_project,
            fake_cook,
            fake_bin,
            response,
            stderr,
            exit_code,
            log,
            child: None,
            socket_override,
        }
    }

    pub fn registry_path(&self) -> PathBuf {
        self.home.join(".jeff/projects.json")
    }

    pub fn write_registry(&self, records: Value) {
        fs::write(
            self.registry_path(),
            serde_json::to_vec_pretty(&records).expect("serialize registry fixture"),
        )
        .expect("write registry fixture");
    }

    pub fn default_record(&self) -> Value {
        json!({
            "id": "project-a",
            "path": self.project,
            "name": "Project A",
            "enabled": true,
            "cook": [self.fake_cook, "--fixture"]
        })
    }

    pub fn path_cook_record(&self) -> Value {
        json!({
            "id": "project-b",
            "path": self.other_project,
            "name": "Project B",
            "enabled": true
        })
    }

    pub fn command(&self) -> Command {
        let mut command = Command::cargo_bin("jeffd").expect("jeffd binary built by cargo test");
        command
            .env("HOME", &self.home)
            .env("PATH", &self.fake_bin)
            .env("FAKE_RESPONSE", &self.response)
            .env("FAKE_STDERR", &self.stderr)
            .env("FAKE_EXIT_CODE", &self.exit_code)
            .env("FAKE_LOG", &self.log);
        if self.socket_override {
            command.env("JEFFD_SOCK", &self.socket);
        } else {
            command.env_remove("JEFFD_SOCK");
        }
        command
    }

    pub fn start(&mut self) {
        self.start_with_env(&[]);
    }

    pub fn start_with_env(&mut self, extra_env: &[(&str, &Path)]) {
        let (events_tx, events_rx) = mpsc::channel();
        let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |event| {
            events_tx
                .send(event)
                .expect("forward socket filesystem event");
        })
        .expect("create socket watcher");
        watcher
            .watch(
                self.socket.parent().expect("socket has parent"),
                RecursiveMode::NonRecursive,
            )
            .expect("watch socket directory");

        let mut command = self.command();
        command.arg("start");
        for (name, value) in extra_env {
            command.env(name, value);
        }
        let child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn foreground jeffd");
        self.child = Some(child);

        if UnixStream::connect(&self.socket).is_ok() {
            return;
        }
        loop {
            match events_rx.recv_timeout(TEST_DEADLINE) {
                Ok(Ok(_)) => {
                    if UnixStream::connect(&self.socket).is_ok() {
                        return;
                    }
                }
                Ok(Err(error)) => panic!("socket watcher failed: {error}"),
                Err(error) => {
                    let child = self.child.as_mut().expect("started child retained");
                    let status = child.try_wait().expect("inspect daemon status");
                    let mut stderr = String::new();
                    if let Some(stream) = child.stderr.as_mut() {
                        stream
                            .read_to_string(&mut stderr)
                            .expect("read daemon stderr after startup failure");
                    }
                    panic!(
                        "daemon did not create a connectable socket: {error}; status={status:?}; stderr={stderr}"
                    );
                }
            }
        }
    }

    pub fn assert_start_is_foreground(&mut self) {
        assert!(
            self.child
                .as_mut()
                .expect("daemon was started")
                .try_wait()
                .expect("inspect daemon child")
                .is_none(),
            "jeffd start must remain the foreground daemon process"
        );
    }

    pub fn client(&self) -> Client {
        Client::connect(&self.socket)
    }

    pub fn run(&self, args: &[&str]) -> Output {
        self.command()
            .args(args)
            .output()
            .expect("run jeffd lifecycle command")
    }

    pub fn stop_and_wait(&mut self) -> Output {
        let output = self.run(&["stop"]);
        self.wait_for_exit();
        output
    }

    pub fn wait_for_exit(&mut self) {
        let mut child = self.child.take().expect("daemon child exists");
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            tx.send(child.wait()).expect("send daemon exit result");
        });
        let status = rx
            .recv_timeout(TEST_DEADLINE)
            .expect("foreground daemon exits after stop")
            .expect("wait for foreground daemon");
        assert!(status.success(), "foreground daemon exit was {status}");
    }

    pub fn take_stderr(&mut self) -> BufReader<ChildStderr> {
        BufReader::new(
            self.child
                .as_mut()
                .expect("daemon child exists")
                .stderr
                .take()
                .expect("daemon stderr is piped"),
        )
    }

    pub fn signal(&self, signal: i32) {
        let pid = self.child.as_ref().expect("daemon child exists").id() as i32;
        assert_eq!(
            unsafe { libc::kill(pid, signal) },
            0,
            "signal daemon process: {}",
            std::io::Error::last_os_error()
        );
    }

    pub fn set_snapshot(&self, generated_at: &str, title: &str) {
        fs::write(&self.response, snapshot(generated_at, title)).expect("replace snapshot fixture");
        fs::write(&self.stderr, "").expect("clear cook stderr");
        fs::write(&self.exit_code, "0\n").expect("restore successful cook exit");
    }

    pub fn set_raw_snapshot(&self, output: &str) {
        fs::write(&self.response, output).expect("replace raw snapshot fixture");
        fs::write(&self.stderr, "").expect("clear cook stderr");
        fs::write(&self.exit_code, "0\n").expect("restore successful cook exit");
    }

    pub fn set_failure(&self, code: i32, stderr: &str) {
        fs::write(&self.exit_code, format!("{code}\n")).expect("write fake exit code");
        fs::write(&self.stderr, stderr).expect("write fake stderr");
    }

    pub fn touch_project(&self, project: &Path, name: &str) {
        fs::write(project.join(".jeff").join(name), b"changed")
            .expect("write watched project file");
    }

    pub fn invocations(&self) -> Vec<String> {
        fs::read_to_string(&self.log)
            .expect("read invocation log")
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub struct Client {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
}

impl Client {
    pub fn connect(socket: &Path) -> Self {
        let writer = UnixStream::connect(socket).expect("connect to jeffd socket");
        writer
            .set_read_timeout(Some(TEST_DEADLINE))
            .expect("bound socket reads");
        writer
            .set_write_timeout(Some(TEST_DEADLINE))
            .expect("bound socket writes");
        let reader = BufReader::new(writer.try_clone().expect("clone client socket"));
        Self { writer, reader }
    }

    pub fn send(&mut self, value: &Value) {
        serde_json::to_writer(&mut self.writer, value).expect("serialize request frame");
        self.writer
            .write_all(b"\n")
            .expect("terminate request frame");
        self.writer.flush().expect("flush request frame");
    }

    pub fn request(&mut self, id: &str, method: &str, params: Value) -> Value {
        self.send(&json!({
            "v": 1,
            "kind": "req",
            "id": id,
            "method": method,
            "params": params
        }));
        self.recv_until(|frame| frame["kind"] == "res" && frame["id"] == id)
    }

    pub fn recv(&mut self) -> Value {
        let mut line = String::new();
        let bytes = self
            .reader
            .read_line(&mut line)
            .expect("read response or event frame");
        assert_ne!(bytes, 0, "connection closed before expected frame");
        serde_json::from_str(&line).expect("server emitted one JSON document")
    }

    pub fn recv_until(&mut self, predicate: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..32 {
            let frame = self.recv();
            if predicate(&frame) {
                return frame;
            }
        }
        panic!("expected frame was not observed within 32 received frames");
    }

    pub fn write_raw(&mut self, bytes: &[u8]) {
        self.writer.write_all(bytes).expect("write raw frame bytes");
        self.writer.flush().expect("flush raw frame bytes");
    }

    pub fn read_eof(&mut self) {
        let mut byte = [0_u8; 1];
        let count = self.reader.read(&mut byte).expect("read connection EOF");
        assert_eq!(count, 0, "server must close the protocol connection");
    }

    pub fn read_one_byte(&mut self) -> usize {
        let mut byte = [0_u8; 1];
        self.reader
            .read(&mut byte)
            .expect("read one response byte or EOF")
    }
    pub fn recv_all_until_eof(&mut self, maximum_frames: usize) -> Vec<Value> {
        let mut frames = Vec::new();
        for _ in 0..maximum_frames {
            let mut line = String::new();
            let bytes = self
                .reader
                .read_line(&mut line)
                .expect("read response, event, or EOF");
            if bytes == 0 {
                return frames;
            }
            frames.push(serde_json::from_str(&line).expect("server emitted one JSON document"));
        }
        panic!("connection did not close within {maximum_frames} frames");
    }
}

pub struct FifoPair {
    pub ready_path: PathBuf,
    pub release_path: PathBuf,
    ready: BufReader<File>,
    release: File,
}

impl FifoPair {
    pub fn new(root: &Path) -> Self {
        let ready_path = root.join("cook-ready.fifo");
        let release_path = root.join("cook-release.fifo");
        make_fifo(&ready_path);
        make_fifo(&release_path);
        let ready = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&ready_path)
            .expect("open ready FIFO without blocking");
        let release = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&release_path)
            .expect("open release FIFO without blocking");
        Self {
            ready_path,
            release_path,
            ready: BufReader::new(ready),
            release,
        }
    }

    pub fn wait_for_run(&mut self) {
        let mut line = String::new();
        self.ready
            .read_line(&mut line)
            .expect("read fake cook ready signal");
        assert_eq!(line, "run\n");
    }

    pub fn release(&mut self) {
        self.release
            .write_all(b"continue\n")
            .expect("release fake cook");
        self.release.flush().expect("flush fake cook release");
    }
}

fn make_fifo(path: &Path) {
    let path = CString::new(path.as_os_str().as_encoded_bytes()).expect("FIFO path has no NUL");
    let result = unsafe { libc::mkfifo(path.as_ptr(), 0o600) };
    assert_eq!(
        result,
        0,
        "create FIFO {}: {}",
        path.to_string_lossy(),
        std::io::Error::last_os_error()
    );
}

pub fn assert_ok(frame: &Value) -> &Value {
    assert_eq!(frame["kind"], "res", "expected response envelope: {frame}");
    assert_eq!(frame["ok"], true, "expected successful response: {frame}");
    &frame["result"]
}

pub fn wait_for_log_lines(path: &Path, minimum: usize) -> Vec<String> {
    let parent = path.parent().expect("log has parent");
    let (events_tx, events_rx) = mpsc::channel();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |event| {
        events_tx.send(event).expect("forward log filesystem event");
    })
    .expect("create log watcher");
    watcher
        .watch(parent, RecursiveMode::NonRecursive)
        .expect("watch log parent");

    loop {
        let lines: Vec<_> = fs::read_to_string(path)
            .expect("read fake cook log")
            .lines()
            .map(str::to_owned)
            .collect();
        if lines.len() >= minimum {
            return lines;
        }
        events_rx
            .recv_timeout(TEST_DEADLINE)
            .expect("fake cook invocation updates log")
            .expect("log watcher event succeeds");
    }
}

pub fn snapshot(generated_at: &str, title: &str) -> String {
    serde_json::to_string(&json!({
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "mode": "lite",
        "tasks": [{
            "id": 1,
            "slug": "one",
            "title": title,
            "status": "in_progress",
            "stage": "implement",
            "priority": "p1",
            "deps": [],
            "blockedReason": null
        }]
    }))
    .expect("serialize snapshot fixture")
}

fn write_executable(path: &Path, contents: &str) {
    fs::write(path, contents).expect("write fake executable");
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .expect("make fake executable runnable");
}

const FAKE_COOK: &str = r#"#!/bin/sh
printf '%s|%s\n' "$PWD" "$*" >> "$FAKE_LOG"
if [ -n "${FAKE_READY_FIFO:-}" ]; then
  printf 'run\n' > "$FAKE_READY_FIFO"
fi
if [ -n "${FAKE_RELEASE_FIFO:-}" ]; then
  IFS= read -r _release < "$FAKE_RELEASE_FIFO"
fi
code=0
IFS= read -r code < "$FAKE_EXIT_CODE"
if [ -s "$FAKE_STDERR" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "$line" >&2
  done < "$FAKE_STDERR"
fi
if [ "$code" -ne 0 ]; then
  exit "$code"
fi
while IFS= read -r line || [ -n "$line" ]; do
  printf '%s\n' "$line"
done < "$FAKE_RESPONSE"
"#;
