import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InactiveSessionPlaceholder, routeProjectionGate } from "./ChatPage";

afterEach(() => {
  cleanup();
});

describe("routeProjectionGate", () => {
  const base = {
    urlConvId: "conv_mine",
    activeConversationId: "conv_mine",
    loadingConversation: false,
    mountIsActive: true,
  };

  it("lets the chat render when the projection is this route's conversation", () => {
    expect(routeProjectionGate(base)).toBeNull();
  });

  it("hydrates an active mount whose route is not projected yet", () => {
    expect(routeProjectionGate({ ...base, activeConversationId: "conv_other" })).toBe("hydrating");
    expect(routeProjectionGate({ ...base, loadingConversation: true })).toBe("hydrating");
  });

  it("shows the inactive placeholder, not the other session's chat, when another mount owns the projection", () => {
    expect(
      routeProjectionGate({ ...base, mountIsActive: false, activeConversationId: "conv_other" }),
    ).toBe("inactive");
    expect(
      routeProjectionGate({
        ...base,
        mountIsActive: false,
        activeConversationId: null,
        loadingConversation: true,
      }),
    ).toBe("inactive");
  });

  it("renders this route's own chat in an inactive mount whose session is projected", () => {
    expect(routeProjectionGate({ ...base, mountIsActive: false })).toBeNull();
  });

  it("promotes a temp route onto the real session it is created as", () => {
    expect(
      routeProjectionGate({
        ...base,
        urlConvId: "temp:draft",
        activeConversationId: "conv_real",
        mountIsActive: false,
      }),
    ).toBeNull();
  });
});

describe("InactiveSessionPlaceholder", () => {
  it("says the session is shown when its app is used, without a composer", () => {
    render(<InactiveSessionPlaceholder />);
    expect(screen.getByText(/This session is shown when you use this app/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
