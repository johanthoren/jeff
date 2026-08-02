use clap::{CommandFactory, Parser};

#[derive( Parser, Debug)]
#[command(
    name = "jeff",
    version,
    about = "Jeff control-plane client"
)]
struct Cli {}

fn main() {
    // Bare invocation must print help and exit 0 until the multi-pane app exists.
    // clap's arg_required_else_help exits 2; match the operator contract instead.
    if std::env::args_os().nth(1).is_none() {
        let mut cmd = Cli::command();
        cmd.print_help().expect("help");
        println!();
        return;
    }

    let _cli = Cli::parse();
}
