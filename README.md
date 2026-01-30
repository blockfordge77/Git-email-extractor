# GitHub Repo Author Audit UI (no raw emails)

Local web UI: paste a **GitHub repository URL** and it will:

- clone the repo (bare, blobless where possible)
- scan commit history for **author names**
- detect whether author emails are **GitHub noreply** vs **non-noreply**
- output **only SHA-256 hashes for non-noreply emails** (no raw emails are shown or saved)

This is intended for **privacy/security auditing** (e.g., maintainers checking if personal emails appear in history).

## Requirements
- Python 3.9+
- `git` installed and available on PATH
- Internet access

### Install git
- Ubuntu/Debian:
  ```bash
  sudo apt-get update && sudo apt-get install -y git
  ```

## Run
```bash
python app.py --port 8000
```

Open:
- http://127.0.0.1:8000

## Notes
- Many repos contain personal emails in commit history. Do not use this to target people.
- GitHub policies prohibit using GitHub data for spamming/unsolicited outreach.
- This tool intentionally avoids outputting raw email addresses.

## License
MIT
