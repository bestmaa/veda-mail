# Adding a mail provider

A provider is a server-only module implementing one stable contract. Neither
the member login nor the mail UI should contain provider-specific conditions.

First decide whether a new adapter is necessary. Providers that accept a full
email address and password/app password over secure IMAP and SMTP can use the
included **Standard IMAP + SMTP** adapter without code.

## 1. Generate the adapter skeleton

Run:

```bash
npm run provider:create -- acme-mail "Acme Mail"
```

This creates two non-overwriting skeleton files under
`src/infrastructure/providers/acme-mail/`. The skeleton intentionally fails
until every gateway operation is implemented; unsupported capabilities must
be declared `false`, not silently simulated.

Alternatively, create the directory manually.

Add `src/infrastructure/providers/<provider>/` with focused files for:

- API client and provider DTOs
- DTO-to-domain mapping
- Read and write operations
- Gateway facade
- Provider module

Every provider implementation file starts with:

```ts
import "server-only";
```

## 2. Implement `MailGateway`

Implement the operations in
`src/application/ports/mail-provider.port.ts`:

```ts
interface MailGateway {
  changePassword(input: MemberPasswordChange): Promise<void>;
  getAccount(): Promise<MailAccount>;
  getMemberProfile(): Promise<MemberProfile>;
  getTwoFactorEnabled(): Promise<boolean>;
  getMessage(messageId: MessageId): Promise<MessageDetail>;
  listMailboxes(): Promise<readonly Mailbox[]>;
  listMessages(query: MessageListQuery): Promise<MessagePage>;
  mutateMessage(mutation: MessageMutation): Promise<void>;
  sendMessage(input: ComposeInput): Promise<SendReceipt>;
  testConnection(): Promise<void>;
  updateMemberProfile(input: MemberProfileUpdate): Promise<MemberProfile>;
  updateTwoFactor(input: MemberTwoFactorUpdate): Promise<void>;
}
```

Provider DTOs must become normalized domain values before being returned.

## 3. Implement `ProviderModule`

The module publishes its manifest and implements:

```ts
interface ProviderModule {
  readonly manifest: ProviderManifest;
  authenticateMember(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ): Promise<MemberAuthenticationResult>;
  parseServiceConfig(input: Readonly<Record<string, string>>):
    Readonly<Record<string, string>>;
  validateServiceConfig(input: Readonly<Record<string, string>>):
    Promise<Readonly<Record<string, string>>>;
  createMemberConfig(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ): Readonly<Record<string, string>>;
  createGateway(connection: ProviderConnection): Promise<MailGateway>;
  rotateMemberSecret(
    config: Readonly<Record<string, string>>,
    newPassword: string,
  ): Readonly<Record<string, string>>;
}
```

Use Zod schemas with `.strict()` for both stored service settings and complete
member connection configuration.

Manifest fields require a scope:

- `scope: "service"` appears only in protected `/admin`.
- `scope: "member"` describes member login credentials.
- Password/token fields also use `secret: true`.

Persistent service configuration must not contain a member password. For
Stalwart, the stored config is only `baseUrl`; `createMemberConfig` adds Basic
authentication, the member email, and their password in memory.

`validateServiceConfig` must apply the provider hostname allowlist, DNS
resolution checks, private-address rejection, TLS requirements, and provider
schema validation before saving. Reuse the shared host policy rather than
opening arbitrary server-side URLs.

## 4. Register the module

Register one instance in `src/bootstrap/provider-registry.ts`:

```ts
registry.register(new ExampleProviderModule());
```

The admin form renders `service` fields from the manifest. The shared member
login supplies email and password. No new React state belongs in a view.

Registration is compile-time by design. It prevents administrators from
uploading executable provider code through the browser. Rebuild and redeploy
after adding an adapter.

## 5. Normalize authentication failures

Do not reveal whether a mailbox exists or return raw upstream responses.
Invalid users, passwords, and provider `401/403` responses must produce the
same generic member-login failure. Never log request authorization headers or
connection configuration.

## 6. Add contract tests

At minimum verify:

- Service and member field separation
- Strict service configuration parsing
- Credential-to-connection translation
- Connection test and generic authentication failure
- Mailbox/message listing, mutations, and sending
- Provider error and DTO normalization
- TLS and hostname-policy enforcement
- OAuth refresh/token-expiry handling, when applicable

Then run:

```bash
npm run check
npm run build
```

## 7. Document deployment requirements

Update the provider documentation with:

- Required provider version and protocols
- Exact server URL shape
- Required outbound ports
- Provider-side user/domain prerequisites
- Authentication limitations
- Any service-level secret lifecycle
- A safe connection and send/receive test

Never add provider credentials to `.env.example`, fixtures, screenshots, or
test snapshots. A contributed adapter must be usable without weakening the
provider hostname policy or sending secrets to the browser.

## Veda-managed member 2FA

Do not call a provider account-management API merely to enable Veda 2FA.
Veda's member TOTP and backup codes are stored independently under `/data` and
run after provider authentication.

The manifest's `supportsTwoFactorAuthentication` flag describes optional
provider-native account management only. The Veda login overlay is available
for every registered provider. OAuth adapters should finish the vendor login
challenge and return `authenticated`; Veda then applies its own second factor.
