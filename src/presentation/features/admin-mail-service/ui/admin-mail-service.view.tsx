import { LoaderCircle } from "lucide-react";

import type { AdminMailServiceViewProps } from "@/presentation/features/admin-mail-service/admin-mail-service.view-model";
import { MailServiceFormView } from "@/presentation/features/admin-mail-service/ui/mail-service-form.view";
import { MailServiceProviderListView } from "@/presentation/features/admin-mail-service/ui/mail-service-provider-list.view";
import { MailServiceStatusView } from "@/presentation/features/admin-mail-service/ui/mail-service-status.view";

export const AdminMailServiceView = (
  props: AdminMailServiceViewProps,
) => (
  <section>
      <p className="text-[11px] font-extrabold uppercase tracking-[0.17em] text-[#ff785a]">
        Organization settings
      </p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-[-0.05em] sm:text-4xl">
        Mail service
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        Choose the provider used by member mailboxes and configure its shared
        service connection.
      </p>

      {props.isLoading ? (
        <section
          aria-label="Loading mail service settings"
          className="mt-8 grid min-h-72 place-items-center rounded-[26px] border border-slate-200 bg-white"
        >
          <div className="text-center text-slate-500">
            <LoaderCircle
              aria-hidden
              className="mx-auto animate-spin text-indigo-500"
              size={26}
            />
            <p className="mt-3 text-sm font-semibold">Loading settings…</p>
          </div>
        </section>
      ) : (
        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[300px_1fr]">
          <aside className="space-y-5 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
            <MailServiceStatusView status={props.status} />
            <MailServiceProviderListView providers={props.providers} />
          </aside>
          <MailServiceFormView
            allowedDomains={props.allowedDomains}
            allowedDomainsInput={props.allowedDomainsInput}
            displayName={props.displayName}
            displayNameInput={props.displayNameInput}
            error={props.error}
            fields={props.fields}
            isSaving={props.isSaving}
            onSubmit={props.onSubmit}
            saveLabel={props.saveLabel}
            success={props.success}
          />
        </div>
      )}
  </section>
);
