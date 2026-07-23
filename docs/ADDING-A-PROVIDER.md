# Adding a mail provider

A provider is a server-only module implementing one stable contract. Neither
the member login nor the mail UI should contain provider-specific conditions.

## 1. Create the adapter

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
  getAccount(): Promise<MailAccount>;
  getMessage(messageId: MessageId): Promise<MessageDetail>;
  listMailboxes(): Promise<readonly Mailbox[]>;
  listMessages(query: MessageListQuery): Promise<MessagePage>;
  mutateMessage(mutation: MessageMutation): Promise<void>;
  sendMessage(input: ComposeInput): Promise<SendReceipt>;
  testConnection(): Promise<void>;
}
```

Provider DTOs must become normalized domain values before being returned.

## 3. Implement `ProviderModule`

The module publishes its manifest and implements:

```ts
interface ProviderModule {
  readonly manifest: ProviderManifest;
  parseServiceConfig(input: Readonly<Record<string, string>>):
    Readonly<Record<string, string>>;
  createMemberConfig(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ): Readonly<Record<string, string>>;
  createGateway(connection: ProviderConnection): Promise<MailGateway>;
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

## 4. Register the module

Register one instance in `src/bootstrap/provider-registry.ts`:

```ts
registry.register(new ExampleProviderModule());
```

The admin form renders `service` fields from the manifest. The shared member
login supplies email and password. No new React state belongs in a view.

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
