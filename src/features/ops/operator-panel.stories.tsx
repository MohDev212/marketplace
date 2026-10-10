import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, spyOn } from "storybook/test";
import { OperatorPanel } from "./operator-panel";
const meta = {
  title: "Marketplace/Operator loading",
  component: OperatorPanel,
} satisfies Meta<typeof OperatorPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LoadingReports: Story = {
  beforeEach: () => {
    const original = globalThis.fetch.bind(globalThis);
    const request = spyOn(globalThis, "fetch").mockImplementation(
      (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        return url.includes("/operator/reports")
          ? new Promise(() => {})
          : original(input, init);
      },
    );
    return () => request.mockRestore();
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByLabelText("Operator access token"),
      "storybook-only",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Load reports" }));
    await expect(
      canvas.getByRole("status", { name: "Loading reports" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Load reports" }),
    ).toBeDisabled();
  },
};
export const CoverageSummary: Story = {
  beforeEach: () => {
    const original = globalThis.fetch.bind(globalThis);
    const request = spyOn(globalThis, "fetch").mockImplementation(
      (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        return url.includes("/operator/coverage")
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  data: {
                    counts: { indexed: 4, candidate: 2, unsupported: 1, quarantined: 1 },
                    unsupported: [{ address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", reason: "fungible_erc20" }],
                    quarantined: [{ address: "0x0123456789abcdef", lastError: "decode_layout_mismatch" }],
                  },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            )
          : original(input, init);
      },
    );
    return () => request.mockRestore();
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByLabelText("Operator access token"),
      "storybook-only",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Load coverage" }));
    await expect(
      await canvas.findByTestId("operator-coverage-summary"),
    ).toBeInTheDocument();
  },
};
