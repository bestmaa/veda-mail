import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerTemplateControlsView } from "@/presentation/features/mail-workspace/ui/composer-template-controls.view";
import { ComposerTemplateDialogsView } from "@/presentation/features/mail-workspace/ui/composer-template-dialogs.view";
import { composerTemplateViewModel } from "../support/composer-template-view-model";

describe("composer template controls", () => {
  it("uses explicit accessible insert and replace actions", () => {
    const templates = composerTemplateViewModel({
      options: [{ id: "template-1", name: "Interview invite" }],
      selectedId: "template-1",
    });
    const html = renderToStaticMarkup(createElement(
      ComposerTemplateControlsView,
      { disabled: false, templates },
    ));
    expect(html).toContain('for="composer-template-select"');
    expect(html).toContain("Email template");
    expect(html).toContain("Insert");
    expect(html).toContain("Replace");
    expect(html).toContain("Save current as new");
    expect(html).toContain("Update selected");
    expect(html).toContain("Delete selected");
  });

  it("disables mutations in a read-only composer", () => {
    const templates = composerTemplateViewModel({
      options: [{ id: "template-1", name: "Interview invite" }],
      selectedId: "template-1",
    });
    const html = renderToStaticMarkup(createElement(
      ComposerTemplateControlsView,
      { disabled: true, templates },
    ));
    expect((html.match(/disabled=""/g) ?? [])).toHaveLength(6);
  });

  it("explains destructive replace boundaries in an alert dialog", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerTemplateDialogsView,
      { templates: composerTemplateViewModel({ dialog: "replace" }) },
    ));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("quoted reply or forwarded text");
    expect(html).toContain("Recipients, attachments, reply context");
    expect(html).toContain("managed signature are kept");
  });

  it("states that saved templates exclude recipients and attachments", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerTemplateDialogsView,
      { templates: composerTemplateViewModel({ dialog: "save" }) },
    ));
    expect(html).toContain("Recipients and attachments are never included");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('maxLength="80"');
  });

  it("locks save controls while the mutation is in flight", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerTemplateDialogsView,
      { templates: composerTemplateViewModel({ dialog: "save", isSaving: true }) },
    ));
    expect((html.match(/disabled=""/gu) ?? [])).toHaveLength(3);
    expect(html).toContain("Saving…");
  });

  it("locks delete dismissal while the mutation is in flight", () => {
    const html = renderToStaticMarkup(createElement(
      ComposerTemplateDialogsView,
      { templates: composerTemplateViewModel({ dialog: "delete", isSaving: true }) },
    ));
    expect(html).toContain('role="alertdialog"');
    expect((html.match(/disabled=""/gu) ?? [])).toHaveLength(2);
    expect(html).toContain("Deleting…");
  });
});
