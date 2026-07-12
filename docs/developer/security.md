# Understand security

Permissions are composed as Privilege → Duty → Role and assigned to users. App access controls whether an app can be opened; table and form privileges control operations inside it.

Framework maintenance requires the seeded administrator or a framework administration role. Never rely only on route visibility: every sensitive API must validate the authenticated user server-side.

Use secure cookies behind HTTPS, replace seeded credentials, keep updater tokens outside source control, and give Docker socket access only to the dedicated updater.

## Related topics

[Configuration](../admin/configuration.md) · [Testing](testing.md)
