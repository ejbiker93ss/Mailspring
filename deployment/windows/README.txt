SummerMail Company Deployment
=============================

Run Install-SummerMail.cmd from this folder. It copies the current installer
to %LOCALAPPDATA%\MSSE\SummerMail\Downloads\<version>, verifies its SHA-256,
and runs the verified local copy.

Managed OpenAI configuration
----------------------------

SummerMail reads the first non-empty value from:

1. MSSE_OPENAI_API_KEY
2. OPENAI_API_KEY

Provision one of these Windows environment variables with Group Policy or your
company's endpoint-management system before SummerMail starts. Never place the
credential in this folder, these scripts, the installer, or source control.

The environment-variable method keeps the credential out of SummerMail's files,
but a credential used directly by a desktop application can be recovered by a
user who controls that PC. For a non-extractable organization credential, route
SummerMail requests through a company-controlled API proxy and keep the OpenAI
credential only on that server.
