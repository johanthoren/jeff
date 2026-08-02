use clap::{CommandFactory, Parser};
use std::io::Write;

#[derive( Parser, Debug)]
#[command(
    name = "jeff",
    version,
    about = "Jeff control-plane client"
)]
struct Cli {}

fn main() -> std::io::Result<()> {
    // Bare invocation must print help and exit 0 until the multi-pane app exists.
    // clap's arg_required_else_help exits 2; match the operator contract instead.
    if std::env::args_os().nth(1).is_none() {
        let mut cmd = Cli::command();
        let mut out = std::io::stdout().lock();
        cmd.write_help(&mut out)?;
        writeln!(out)?;
        return Ok(());
    }

    let _cli = Cli::parse();
    Ok(())
}
