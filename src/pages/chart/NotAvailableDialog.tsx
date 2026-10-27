import { dismissNotAvailable, useNotAvailable } from "./notAvailable.ts";
import { Modal } from "./ui.tsx";

/** "Oops, Not available": shown in place of TradingView's paywall prompts. */
export function NotAvailableDialog() {
  const feature = useNotAvailable();
  return (
    <Modal open={feature !== null} title="Oops, Not available" onClose={dismissNotAvailable} width={440}>
      <div className="px-5 pb-5 text-[14px] leading-[22px]">
        <p>
          <span className="font-semibold">{feature}</span> isn't available in this TradingView clone.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={dismissNotAvailable}
            className="h-[34px] rounded-md bg-tv-active px-5 text-tv-active-foreground hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}
