import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setOmnigentHostConfig, type McpConnectionStatus, type McpServicesPage } from "@/lib/host";
import { McpConnectionPicker } from "@/shell/McpConnectionPicker";

function renderPicker(
  connections: McpConnectionStatus[],
  selected: string[] = [],
  authorize: (name: string) => Promise<void> = async () => undefined,
) {
  setOmnigentHostConfig({ mcpConnections: { list: async () => connections, authorize } });
  const onToggle = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <McpConnectionPicker selected={new Set(selected)} onToggle={onToggle} />
    </QueryClientProvider>,
  );
  return { onToggle };
}

async function openPicker() {
  fireEvent.click(await screen.findByTestId("new-chat-landing-mcps-chip"));
}

describe("McpConnectionPicker", () => {
  afterEach(() => {
    cleanup();
    setOmnigentHostConfig({});
  });

  it("counts admin-provided servers as on without a selection", async () => {
    renderPicker([
      { name: "tools.slack", displayName: "Slack", authorized: true, providedByAdmin: true },
      { name: "tools.github", displayName: "GitHub", authorized: true },
    ]);
    expect(await screen.findByTestId("new-chat-landing-mcps-chip")).toHaveTextContent("MCPs · 1");
  });

  it("locks an admin-provided server on", async () => {
    const { onToggle } = renderPicker([
      { name: "tools.slack", displayName: "Slack", authorized: true, providedByAdmin: true },
    ]);
    await openPicker();
    const toggle = await screen.findByTestId("new-chat-landing-mcp-toggle-tools.slack");
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText("Added by your admin")).toBeInTheDocument();
    expect(screen.queryByTestId("new-chat-landing-mcp-signin-tools.slack")).toBeNull();
  });

  it("offers sign-in for an admin-provided server the user hasn't connected", async () => {
    const authorize = vi.fn(async () => undefined);
    const { onToggle } = renderPicker(
      [
        {
          name: "tools.github",
          displayName: "GitHub",
          authorized: false,
          providedByAdmin: true,
        },
      ],
      [],
      authorize,
    );
    expect(await screen.findByTestId("new-chat-landing-mcps-needs-signin")).toHaveTextContent(
      "1 needs sign-in",
    );
    await openPicker();
    fireEvent.click(await screen.findByTestId("new-chat-landing-mcp-signin-tools.github"));
    await waitFor(() => expect(authorize).toHaveBeenCalledWith("tools.github"));
    // Signing in doesn't add it to the selection: it's on because the admin provides it.
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("offers sign-in for a restored selection whose grant lapsed, keeping it selected", async () => {
    const authorize = vi.fn(async () => undefined);
    const { onToggle } = renderPicker(
      [{ name: "tools.slack", displayName: "Slack", authorized: false }],
      ["tools.slack"],
      authorize,
    );
    await openPicker();
    const toggle = await screen.findByTestId("new-chat-landing-mcp-toggle-tools.slack");
    expect(toggle).toBeChecked();
    expect(toggle).not.toBeDisabled();
    expect(screen.getByText("Needs sign-in")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("new-chat-landing-mcp-signin-tools.slack"));
    await waitFor(() => expect(authorize).toHaveBeenCalledWith("tools.slack"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows no sign-in action for a server that is off", async () => {
    renderPicker([{ name: "tools.github", displayName: "GitHub", authorized: false }]);
    await openPicker();
    await screen.findByTestId("new-chat-landing-mcp-toggle-tools.github");
    expect(screen.queryByTestId("new-chat-landing-mcp-signin-tools.github")).toBeNull();
  });

  it("still lets the user toggle servers the admin doesn't provide", async () => {
    const { onToggle } = renderPicker([
      { name: "tools.github", displayName: "GitHub", authorized: true },
    ]);
    await openPicker();
    const toggle = await screen.findByTestId("new-chat-landing-mcp-toggle-tools.github");
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith("tools.github", true);
  });

  describe("browsing other MCP services", () => {
    const LINEAR = "team.default.linear";
    const EXA = "team.tools.exa";
    const GITHUB: McpConnectionStatus = {
      name: "tools.github",
      displayName: "GitHub",
      authorized: true,
    };
    // Status the host lists back for each custom service once it's included.
    const CUSTOM: Record<string, McpConnectionStatus> = {
      [LINEAR]: { name: LINEAR, displayName: "linear", authorized: false },
      [EXA]: { name: EXA, displayName: "exa", authorized: true },
    };

    // Holds the selection like the new-session screen does, so a pick shows up as on.
    function SelectionHarness({ initial }: { initial: string[] }) {
      const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initial));
      return (
        <McpConnectionPicker
          selected={selected}
          onToggle={(name, next) =>
            setSelected((previous) => {
              const updated = new Set(previous);
              if (next) updated.add(name);
              else updated.delete(name);
              return updated;
            })
          }
        />
      );
    }

    function renderBrowsable({
      pages,
      initial = [],
      base = [GITHUB],
    }: {
      pages: McpServicesPage[];
      initial?: string[];
      base?: McpConnectionStatus[];
    }) {
      const list = vi.fn(async () => base);
      const status = vi.fn(async (name: string) => CUSTOM[name] ?? null);
      const browse = vi.fn(
        async (options?: { pageToken?: string }): Promise<McpServicesPage> =>
          pages[options?.pageToken ? Number(options.pageToken) : 0]!,
      );
      const authorize = vi.fn(async () => undefined);
      setOmnigentHostConfig({ mcpConnections: { list, authorize, status, browse } });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <SelectionHarness initial={initial} />
        </QueryClientProvider>,
      );
      return { list, status, browse, authorize };
    }

    const BOTH: McpServicesPage = {
      services: [
        { name: LINEAR, displayName: "linear" },
        { name: EXA, displayName: "exa" },
      ],
    };

    async function openBrowse() {
      await openPicker();
      fireEvent.click(await screen.findByTestId("new-chat-landing-mcps-browse"));
    }

    const browseBox = (name: string) => screen.findByTestId(`new-chat-landing-mcps-browse-${name}`);

    it("offers no browse entry when the host can't browse", async () => {
      renderPicker([GITHUB]);
      await openPicker();
      await screen.findByTestId("new-chat-landing-mcp-toggle-tools.github");
      expect(screen.queryByTestId("new-chat-landing-mcps-browse")).toBeNull();
    });

    it("switches on several services without leaving browse, signing in where needed", async () => {
      const { authorize, list } = renderBrowsable({ pages: [BOTH] });
      await openBrowse();
      fireEvent.click(await browseBox(LINEAR));
      await waitFor(() => expect(authorize).toHaveBeenCalledWith(LINEAR));
      await waitFor(async () => expect(await browseBox(LINEAR)).toBeChecked());
      const listCalls = list.mock.calls.length;
      fireEvent.click(await browseBox(EXA));
      await waitFor(async () => expect(await browseBox(EXA)).toBeChecked());
      // EXA is already connected, so only LINEAR asked to sign in.
      expect(authorize).toHaveBeenCalledTimes(1);
      // A pick reads only its own status; the list isn't fetched again.
      expect(list).toHaveBeenCalledTimes(listCalls);
      expect(screen.queryByText("Needs sign-in")).toBeNull();
      expect(screen.queryByText("Connected")).toBeNull();

      fireEvent.click(screen.getByTestId("new-chat-landing-mcps-browse-back"));
      expect(await screen.findByTestId(`new-chat-landing-mcp-toggle-${LINEAR}`)).toBeChecked();
      expect(screen.getByTestId(`new-chat-landing-mcp-toggle-${EXA}`)).toBeChecked();
      expect(screen.getByTestId("new-chat-landing-mcps-chip")).toHaveTextContent("MCPs · 2");
    });

    it("leaves a browse switch off when its sign-in is cancelled", async () => {
      const { authorize } = renderBrowsable({ pages: [BOTH] });
      authorize.mockRejectedValueOnce(new Error("closed"));
      await openBrowse();
      const box = await browseBox(LINEAR);
      fireEvent.click(box);
      expect(await screen.findByText("Sign-in failed — try again")).toBeInTheDocument();
      expect(box).not.toBeChecked();
    });

    it("switching off in browse switches the service off in the list", async () => {
      renderBrowsable({ pages: [BOTH], initial: [EXA] });
      await openBrowse();
      const box = await browseBox(EXA);
      expect(box).toBeChecked();
      fireEvent.click(box);
      await waitFor(() => expect(box).not.toBeChecked());
      fireEvent.click(screen.getByTestId("new-chat-landing-mcps-browse-back"));
      expect(await screen.findByTestId(`new-chat-landing-mcp-toggle-${EXA}`)).not.toBeChecked();
    });

    it("locks an admin-provided service on in browse", async () => {
      renderBrowsable({
        pages: [{ services: [{ name: EXA, displayName: "exa" }] }],
        base: [GITHUB, { ...CUSTOM[EXA]!, providedByAdmin: true }],
      });
      await openBrowse();
      const box = await browseBox(EXA);
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
      expect(screen.getByText("Added by your admin")).toBeInTheDocument();
    });

    it("drops a switched-off custom service once the popover closes", async () => {
      renderBrowsable({ pages: [BOTH] });
      await openBrowse();
      fireEvent.click(await browseBox(EXA));
      fireEvent.click(screen.getByTestId("new-chat-landing-mcps-browse-back"));
      const toggle = await screen.findByTestId(`new-chat-landing-mcp-toggle-${EXA}`);
      fireEvent.click(toggle);
      await waitFor(() => expect(toggle).not.toBeChecked());
      // Still listed while the popover is open.
      expect(screen.getByTestId(`new-chat-landing-mcp-toggle-${EXA}`)).toBeInTheDocument();

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await openPicker();
      await screen.findByTestId("new-chat-landing-mcp-toggle-tools.github");
      await waitFor(() =>
        expect(screen.queryByTestId(`new-chat-landing-mcp-toggle-${EXA}`)).toBeNull(),
      );
    });

    it("lists servers alphabetically whether on or off, and labels custom ones", async () => {
      renderBrowsable({
        pages: [{ services: [] }],
        initial: [LINEAR, EXA],
        base: [{ name: "tools.asana", displayName: "Asana", authorized: true }, GITHUB],
      });
      await openPicker();
      await screen.findByTestId(`new-chat-landing-mcp-toggle-${LINEAR}`);
      const order = screen
        .getAllByTestId(/^new-chat-landing-mcp-toggle-/)
        .map((toggle) => toggle.dataset.testid?.replace("new-chat-landing-mcp-toggle-", ""));
      // On/off and sign-in state don't affect the order.
      expect(order).toEqual(["tools.asana", EXA, "tools.github", LINEAR]);
      expect(screen.getByTestId(`new-chat-landing-mcp-${LINEAR}`)).toHaveTextContent(
        "linear · team.default",
      );
      // A listed connection needs no qualifier.
      expect(screen.getByTestId("new-chat-landing-mcp-tools.github")).not.toHaveTextContent(
        "· tools",
      );
    });

    it("reads the status of a restored selection the host doesn't list, but not listed names", async () => {
      const { status } = renderBrowsable({
        pages: [{ services: [] }],
        initial: [LINEAR, GITHUB.name],
      });
      await openPicker();
      expect(await screen.findByTestId(`new-chat-landing-mcp-toggle-${LINEAR}`)).toBeChecked();
      expect(status).toHaveBeenCalledWith(LINEAR);
      expect(status).not.toHaveBeenCalledWith(GITHUB.name);
    });

    it("switches off a service with no status, saying why", async () => {
      renderBrowsable({
        pages: [{ services: [{ name: "team.x.no_access", displayName: "no_access" }] }],
      });
      await openBrowse();
      const box = await browseBox("team.x.no_access");
      fireEvent.click(box);
      expect(await screen.findByText("You don't have permission to use this")).toBeInTheDocument();
      await waitFor(() => expect(box).not.toBeChecked());
    });

    it("walks pages while a search has too few matches", async () => {
      const { browse } = renderBrowsable({
        pages: [
          { services: [{ name: "team.a.exa", displayName: "exa" }], nextPageToken: "1" },
          { services: [{ name: LINEAR, displayName: "linear" }] },
        ],
      });
      await openBrowse();
      await browseBox("team.a.exa");
      expect(browse).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByTestId("new-chat-landing-mcps-browse-search"), {
        target: { value: "linear" },
      });
      expect(await browseBox(LINEAR)).toBeInTheDocument();
      expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: "1" }));
      expect(screen.queryByTestId("new-chat-landing-mcps-browse-team.a.exa")).toBeNull();
    });

    it("stops walking pages after one fails, leaving Load more to retry", async () => {
      const { browse } = renderBrowsable({
        pages: [{ services: [{ name: "team.a.exa", displayName: "exa" }], nextPageToken: "1" }],
      });
      browse.mockImplementation(async (options) => {
        if (options?.pageToken) throw new Error("unavailable");
        return { services: [{ name: "team.a.exa", displayName: "exa" }], nextPageToken: "1" };
      });
      await openBrowse();
      await browseBox("team.a.exa");
      fireEvent.change(screen.getByTestId("new-chat-landing-mcps-browse-search"), {
        target: { value: "linear" },
      });
      expect(await screen.findByText("Couldn't load MCP servers.")).toBeInTheDocument();
      expect(screen.getByTestId("new-chat-landing-mcps-browse-more")).toBeInTheDocument();
      expect(browse).toHaveBeenCalledTimes(2);
    });
  });
});
