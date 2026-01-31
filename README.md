# GitHub Repo Author Audit UI

Local web UI: paste a **GitHub repository URL** and it will:

- clone the repo (bare, blobless where possible)
- scan commit history for **author names and email addresses**
- detect whether author emails are **GitHub noreply** vs **non-noreply**
- send personalized emails to authors using customizable templates

This is intended for **privacy/security auditing** and **outreach** (e.g., maintainers checking if personal emails appear in history or contacting contributors).

## Requirements
- Python 3.9+
- `git` installed and available on PATH
- Internet access
- (Optional) `python-dotenv` for `.env` file support:
  ```bash
  pip install python-dotenv
  ```
  Or install all requirements:
  ```bash
  pip install -r requirements.txt
  ```

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

## Email Sending (SMTP Setup)

After running an audit, you can send emails to authors using the email template feature. SMTP settings are configured in a `.env` file.

### Setup

1. **Install python-dotenv** (optional but recommended):
   ```bash
   pip install python-dotenv
   ```

2. **Create a `.env` file** in the project root:
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env`** and fill in your SMTP settings:
   ```env
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USE_TLS=true
   SMTP_USERNAME=your-email@gmail.com
   SMTP_PASSWORD=your-app-password
   SENDER_EMAIL=your-email@gmail.com
   ```

4. **Run the application** - SMTP settings will be loaded automatically from `.env`

### Gmail Configuration

**Important**: Gmail requires App Passwords for SMTP authentication.

1. **Enable 2-Step Verification**:
   - Go to: https://myaccount.google.com/security
   - Click "2-Step Verification" and follow setup

2. **Generate an App Password**:
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and your device, then generate
   - Copy the 16-character password

3. **Add to `.env`**:
   ```env
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USE_TLS=true
   SMTP_USERNAME=your-email@gmail.com
   SMTP_PASSWORD=your-16-char-app-password
   SENDER_EMAIL=your-email@gmail.com
   ```

### Outlook/Hotmail Configuration
```env
SMTP_SERVER=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USE_TLS=true
SMTP_USERNAME=your-email@outlook.com
SMTP_PASSWORD=your-password
SENDER_EMAIL=your-email@outlook.com
```

### Other Providers
Check your email provider's SMTP documentation. Common ports:
- **587**: TLS/STARTTLS (recommended)
- **465**: SSL

### Email Template Placeholders
- `{first_name}` - Author's first name (recommended)
- `{author_name}` - Author's full name (backward compatible, uses first name)
- `{email}` - Author's email address
- `{commits}` - Number of commits by this author
- `{repo_url}` - Repository URL

## Notes
- Many repos contain personal emails in commit history. Use responsibly and ethically.
- GitHub policies prohibit using GitHub data for spamming/unsolicited outreach.
- Always respect privacy and only send emails when appropriate.
- For Gmail, you must use an App Password if 2-Step Verification is enabled.

## License
MIT
