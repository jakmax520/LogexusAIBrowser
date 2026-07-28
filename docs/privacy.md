# Logexus AI Browser — Privacy Policy

**Last updated: 2026-07-28**

## Data Collection

Logexus AI Browser **does not collect, transmit, or store any user data on external servers**.

All data processing occurs exclusively on the user's local machine:

- **Page DOM data**: Extracted and structured locally in the Content Script. Only interactive elements are extracted (≤80 elements). This data is sent only to the user-configured AI Agent via local WebSocket (127.0.0.1:9527).
- **Screenshots**: Captured only on user request or when an action fails. Stored temporarily in memory and returned to the calling AI Agent. Never persisted to disk or uploaded.
- **Browser session data**: The extension reuses existing browser cookies and sessions. No passwords or credentials are stored.
- **Audit logs**: Stored locally in the browser's IndexedDB. Never transmitted externally. User can export logs as JSON at any time.

## Permissions Justification

| Permission | Purpose |
|:--|:--|
| `activeTab` | Access the current active tab for DOM operations |
| `tabs` | Manage multi-tab workflows and navigation |
| `scripting` | Inject Content Script to execute browser actions |
| `storage` | Store user preferences (theme, token) and macros locally |
| `nativeMessaging` | Enable external applications to communicate with the extension via Chrome's secure Native Messaging API |
| `host_permissions: <all_urls>` | Execute automation on any website the user navigates to |

## WebSocket Communication

The extension connects to a local WebSocket daemon at `ws://127.0.0.1:9527`. This daemon runs on the user's own machine and never communicates with external servers. Authentication is via a user-configurable token.

## Third-Party Services

This extension **does not** integrate with any third-party analytics, advertising, or tracking services. It contains no telemetry or usage reporting.

## Data Retention

- Audit logs are retained in local IndexedDB until the user clears them
- No data is ever sent to cloud servers
- Uninstalling the extension removes all local data

## Contact

For privacy concerns, open an issue at: https://github.com/jakmax520/LogexusAIBrowser
