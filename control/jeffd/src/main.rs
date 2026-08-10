use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "jeffd", version, about = "Jeff read-only projector daemon")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the daemon in the foreground.
    Start,
    /// Ask the running daemon to stop.
    Stop,
    /// Check the daemon with a protocol hello.
    Status,
}

fn main() {
    let result = match Cli::parse().command {
        Command::Start => jeffd::start(),
        Command::Stop => jeffd::stop(),
        Command::Status => jeffd::status().map(|()| println!("running")),
    };
    if let Err(error) = result {
        eprintln!("jeffd: {error}");
        std::process::exit(1);
    }
}
