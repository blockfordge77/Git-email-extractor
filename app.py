#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import smtplib
import subprocess
import tempfile
from dataclasses import dataclass, asdict
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

try:
    from dotenv import load_dotenv
    # Load .env file from the same directory as this script
    env_path = Path(__file__).parent / ".env"
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass  # dotenv is optional


STATIC_DIR = Path(__file__).parent / "static"
NOREPLY_RE = re.compile(r"@users\.noreply\.github\.com$", re.IGNORECASE)


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="ignore")).hexdigest()


def get_first_name(full_name: str) -> str:
    """Extract first name from full name."""
    if not full_name or full_name == "(no name)":
        return full_name
    # Split by spaces and take the first part
    parts = full_name.strip().split()
    return parts[0] if parts else full_name


def run(cmd: list[str], cwd: str | None = None) -> str:
    try:
        out = subprocess.check_output(cmd, cwd=cwd, stderr=subprocess.STDOUT, text=True)
        return out
    except FileNotFoundError:
        raise RuntimeError(f"Required command not found: {cmd[0]} (install it and retry)")
    except subprocess.CalledProcessError as e:
        msg = (e.output or "").strip()
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{msg}")


def normalize_repo_url(s: str) -> str | None:
    s = (s or "").strip()
    if not s:
        return None
    if "://" not in s:
        return None
    u = urlparse(s)
    if u.scheme not in ("http", "https"):
        return None
    if u.netloc.lower() not in ("github.com", "www.github.com"):
        return None
    parts = [p for p in u.path.split("/") if p]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1]
    # strip .git
    if repo.endswith(".git"):
        repo = repo[:-4]
    # basic validation
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", owner):
        return None
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", repo):
        return None
    return f"https://github.com/{owner}/{repo}"


def clone_bare(repo_url: str, dst: str) -> None:
    # Prefer blobless bare clone (fast/small); fallback if unsupported
    try:
        run(["git", "clone", "--bare", "--filter=blob:none", repo_url, dst])
    except RuntimeError:
        run(["git", "clone", "--bare", repo_url, dst])


@dataclass
class AuthorRow:
    author_name: str
    first_name: str
    commits: int
    email_type: str  # "noreply" or "non-noreply" or "missing"
    email: str  # actual email address for non-noreply, else ""


@dataclass
class RepoAuditReport:
    repo_url: str
    scanned_commits: int
    unique_authors: int
    unique_non_noreply_emails: int
    authors: list[AuthorRow]
    note: str


def send_emails(payload: dict) -> dict:
    """Send emails to recipients using the provided template and SMTP settings from .env."""
    # Get SMTP settings from environment variables
    smtp_server = os.getenv("SMTP_SERVER", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
    smtp_username = os.getenv("SMTP_USERNAME", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    sender_email = os.getenv("SENDER_EMAIL", "").strip()
    
    # Get email content from payload
    email_subject = payload.get("email_subject", "").strip()
    email_template = payload.get("email_template", "").strip()
    recipients = payload.get("recipients", [])
    repo_url = payload.get("repo_url", "")

    # Check which variables are missing and provide detailed error message
    missing = []
    if not smtp_server:
        missing.append("SMTP_SERVER")
    if not smtp_username:
        missing.append("SMTP_USERNAME")
    if not smtp_password:
        missing.append("SMTP_PASSWORD")
    if not sender_email:
        missing.append("SENDER_EMAIL")
    
    if missing:
        raise ValueError(f"Missing SMTP configuration in .env file. Please set: {', '.join(missing)}")
    
    if not email_subject or not email_template:
        raise ValueError("Missing email subject or template")

    if not recipients:
        raise ValueError("No recipients provided")

    sent = 0
    failed = 0
    errors = []

    try:
        if smtp_use_tls:
            server = smtplib.SMTP(smtp_server, smtp_port)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(smtp_server, smtp_port)
        
        server.login(smtp_username, smtp_password)

        for recipient in recipients:
            email = recipient.get("email", "").strip()
            if not email:
                failed += 1
                continue

            try:
                # Replace placeholders in template
                body = email_template
                # Support both {author_name} and {first_name} for backward compatibility
                first_name = recipient.get("first_name", recipient.get("author_name", ""))
                body = body.replace("{author_name}", first_name)
                body = body.replace("{first_name}", first_name)
                body = body.replace("{email}", email)
                body = body.replace("{commits}", str(recipient.get("commits", 0)))
                body = body.replace("{repo_url}", repo_url)

                # Create message
                msg = MIMEMultipart()
                msg["From"] = sender_email
                msg["To"] = email
                msg["Subject"] = email_subject
                msg.attach(MIMEText(body, "plain"))

                # Send email
                server.send_message(msg)
                sent += 1
            except Exception as e:
                failed += 1
                errors.append(f"{email}: {str(e)}")

        server.quit()
    except Exception as e:
        raise RuntimeError(f"SMTP connection error: {str(e)}")

    return {
        "sent": sent,
        "failed": failed,
        "total": len(recipients),
        "errors": errors[:10] if errors else []  # Limit error details
    }


def audit_repo(repo_url: str, max_commits: int) -> RepoAuditReport:
    tmp_root = tempfile.mkdtemp(prefix="repo-author-audit-")
    repo_dir = os.path.join(tmp_root, "repo.git")

    try:
        clone_bare(repo_url, repo_dir)

        # Null-delimited output to be robust:
        # %an = author name, %ae = author email
        out = run(["git", "log", f"-n{max_commits}", "--format=%an%x00%ae"], cwd=repo_dir)

        author_map: dict[tuple[str, str], int] = {}
        author_emails: dict[tuple[str, str], str] = {}  # map (name, tag) -> email
        non_emails: set[str] = set()
        scanned = 0

        for line in out.splitlines():
            scanned += 1
            # line = "name\0email"
            if "\x00" in line:
                name, email = line.split("\x00", 1)
            else:
                name, email = line, ""
            name = (name or "").strip() or "(no name)"
            email = (email or "").strip()

            if not email:
                key = (name, "missing")
                author_map[key] = author_map.get(key, 0) + 1
                author_emails[key] = ""
                continue

            if NOREPLY_RE.search(email):
                key = (name, "noreply")
                author_map[key] = author_map.get(key, 0) + 1
                author_emails[key] = email
            else:
                email_lower = email.lower()
                non_emails.add(email_lower)
                key = (name, f"non:{email_lower}")
                author_map[key] = author_map.get(key, 0) + 1
                author_emails[key] = email

        rows: list[AuthorRow] = []
        for (name, tag), count in author_map.items():
            email = author_emails.get((name, tag), "")
            first_name = get_first_name(name)
            if tag == "missing":
                rows.append(AuthorRow(author_name=name, first_name=first_name, commits=count, email_type="missing", email=""))
            elif tag == "noreply":
                rows.append(AuthorRow(author_name=name, first_name=first_name, commits=count, email_type="noreply", email=email))
            elif tag.startswith("non:"):
                rows.append(AuthorRow(author_name=name, first_name=first_name, commits=count, email_type="non-noreply", email=email))
            else:
                rows.append(AuthorRow(author_name=name, first_name=first_name, commits=count, email_type="unknown", email=""))

        # Sort: most commits first
        rows.sort(key=lambda r: r.commits, reverse=True)

        return RepoAuditReport(
            repo_url=repo_url,
            scanned_commits=min(max_commits, scanned),
            unique_authors=len({r.author_name for r in rows}),
            unique_non_noreply_emails=len(non_emails),
            authors=rows[:500],  # cap
            note="",
        )
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, (STATIC_DIR / "index.html").read_bytes(), "text/html; charset=utf-8")
            return
        if self.path == "/app.js":
            self._send(200, (STATIC_DIR / "app.js").read_bytes(), "text/javascript; charset=utf-8")
            return
        if self.path == "/styles.css":
            self._send(200, (STATIC_DIR / "styles.css").read_bytes(), "text/css; charset=utf-8")
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_POST(self):
        if self.path == "/api/audit":
            self._handle_audit()
        elif self.path == "/api/send-emails":
            self._handle_send_emails()
        else:
            self._send(404, b"Not found", "text/plain; charset=utf-8")

    def _handle_audit(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8", errors="replace")

        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            self._send(400, b'{"error":"Invalid JSON"}', "application/json; charset=utf-8")
            return

        repo_input = str(payload.get("repo", "")).strip()
        repo_url = normalize_repo_url(repo_input)
        if not repo_url:
            self._send(400, json.dumps({"error": "Invalid GitHub repo URL (expected https://github.com/OWNER/REPO)"}).encode("utf-8"),
                       "application/json; charset=utf-8")
            return

        try:
            max_commits = int(payload.get("max_commits") or 2000)
            if max_commits <= 0 or max_commits > 200000:
                raise ValueError()
        except ValueError:
            self._send(400, json.dumps({"error": "max_commits must be a number between 1 and 200000"}).encode("utf-8"),
                       "application/json; charset=utf-8")
            return

        try:
            report = audit_repo(repo_url, max_commits)
            self._send(200, json.dumps(asdict(report)).encode("utf-8"), "application/json; charset=utf-8")
        except RuntimeError as e:
            self._send(502, json.dumps({"error": str(e)}).encode("utf-8"), "application/json; charset=utf-8")

    def _handle_send_emails(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8", errors="replace")

        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            self._send(400, b'{"error":"Invalid JSON"}', "application/json; charset=utf-8")
            return

        try:
            result = send_emails(payload)
            self._send(200, json.dumps(result).encode("utf-8"), "application/json; charset=utf-8")
        except Exception as e:
            self._send(500, json.dumps({"error": str(e)}).encode("utf-8"), "application/json; charset=utf-8")

    def log_message(self, fmt, *args):
        return


def main():
    ap = argparse.ArgumentParser(description="Local UI to audit repo author emails.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Running on http://{args.host}:{args.port}")
    print("Paste a GitHub repo URL; results show author names and email addresses.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
