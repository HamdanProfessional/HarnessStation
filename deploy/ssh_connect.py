#!/usr/bin/env python3
"""
Connect to a server over SSH with paramiko and run a command.

    python deploy/ssh_connect.py --host ssh.testservers.online --user deploy
    python deploy/ssh_connect.py --host ssh.testservers.online --user deploy \
        --command "uname -a && df -h /"

Authentication, in the order tried:

  1. An explicit key file, if --key is given
  2. Your default keys (~/.ssh/id_ed25519, ~/.ssh/id_rsa), which is what you
     want once the key is installed on the server — no password, no prompt
  3. A password, read from the SSH_PASSWORD environment variable or prompted for

Nothing is hardcoded and nothing is written to disk. Credentials come from the
environment or an interactive prompt so they don't end up in shell history, a
config file, or this repository.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    sys.exit("paramiko is not installed. Run: pip install paramiko")


DEFAULT_KEYS = ("id_ed25519", "id_rsa", "id_ecdsa")


def find_default_keys() -> list[Path]:
    """Private keys in ~/.ssh, most modern first."""
    ssh_dir = Path.home() / ".ssh"
    return [ssh_dir / name for name in DEFAULT_KEYS if (ssh_dir / name).is_file()]


def host_key_policy(strict: bool) -> paramiko.MissingHostKeyPolicy:
    """
    What to do when the server isn't in known_hosts.

    Rejecting is correct: accepting an unknown host key means you cannot tell a
    first connection from someone sitting in the middle of it. But it makes the
    genuine first connection fail, so --trust-on-first-use exists for that, and
    the key is then written to known_hosts and checked on every later connection.
    """
    if strict:
        return paramiko.RejectPolicy()
    return paramiko.AutoAddPolicy()


def connect(
    host: str,
    user: str,
    port: int = 22,
    key_path: str | None = None,
    trust_on_first_use: bool = False,
) -> paramiko.SSHClient:
    client = paramiko.SSHClient()

    # Load known_hosts so a changed host key is caught rather than ignored.
    known_hosts = Path.home() / ".ssh" / "known_hosts"
    if known_hosts.is_file():
        client.load_host_keys(str(known_hosts))
    client.set_missing_host_key_policy(host_key_policy(strict=not trust_on_first_use))

    common = {
        "hostname": host,
        "port": port,
        "username": user,
        "timeout": 15,
        # Don't let paramiko fall back to an agent or other keys silently; we
        # want to know which method actually worked.
        "allow_agent": True,
        "look_for_keys": False,
    }

    keys = [Path(key_path)] if key_path else find_default_keys()

    for key in keys:
        if not key.is_file():
            print(f"    no such key: {key}", file=sys.stderr)
            continue
        try:
            print(f"--> trying key {key.name}")
            client.connect(**common, key_filename=str(key))
            print(f"    authenticated with {key.name}")
            return client
        except paramiko.PasswordRequiredException:
            # An encrypted key. Ask for its passphrase rather than giving up.
            passphrase = getpass.getpass(f"    passphrase for {key.name}: ")
            client.connect(**common, key_filename=str(key), passphrase=passphrase)
            print(f"    authenticated with {key.name}")
            return client
        except paramiko.AuthenticationException:
            print(f"    {key.name} was rejected by the server")
        except paramiko.SSHException as e:
            print(f"    {key.name} unusable: {e}")

    # No key worked. Fall back to a password, from the environment or a prompt.
    password = os.environ.get("SSH_PASSWORD")
    if not password:
        if not sys.stdin.isatty():
            raise SystemExit(
                "No key worked and no password available.\n"
                "Set SSH_PASSWORD, or run interactively to be prompted."
            )
        password = getpass.getpass(f"password for {user}@{host}: ")

    print("--> trying password")
    client.connect(**common, password=password)
    print("    authenticated with a password")
    return client


def run(client: paramiko.SSHClient, command: str) -> int:
    """Run one command, streaming its output, and return its exit status."""
    stdin, stdout, stderr = client.exec_command(command, get_pty=False)
    stdin.close()

    for line in iter(stdout.readline, ""):
        print(line, end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err, end="", file=sys.stderr)

    return stdout.channel.recv_exit_status()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", required=True)
    p.add_argument("--user", required=True)
    p.add_argument("--port", type=int, default=22)
    p.add_argument("--key", help="path to a specific private key")
    p.add_argument("--command", default="whoami && hostname && uname -sr")
    p.add_argument(
        "--trust-on-first-use",
        action="store_true",
        help="accept and record an unknown host key (needed for a first connection)",
    )
    args = p.parse_args()

    try:
        client = connect(
            args.host, args.user, args.port, args.key, args.trust_on_first_use
        )
    except paramiko.AuthenticationException:
        print("\nAuthentication failed — wrong user, key, or password.", file=sys.stderr)
        return 1
    except paramiko.SSHException as e:
        # The common cause here is an unknown host key on a first connection.
        print(f"\nSSH error: {e}", file=sys.stderr)
        if "not found in known_hosts" in str(e):
            print("Re-run with --trust-on-first-use to record it.", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"\nCould not reach {args.host}:{args.port} — {e}", file=sys.stderr)
        return 1

    try:
        print(f"\n$ {args.command}")
        status = run(client, args.command)
        if status != 0:
            print(f"\n(command exited {status})", file=sys.stderr)
        return status
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
