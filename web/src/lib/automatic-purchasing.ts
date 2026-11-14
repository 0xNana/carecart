import { OperatorApiError } from "./operator-client.ts";

export type AutomaticPurchasingSnapshot = {
  version: number;
  enabled: boolean;
  policy: {
    maxAutomaticAmount: string;
    expiresAt: string;
    suppliers: string[];
    itemIds: string[];
  } | null;
};
export function parseAutomaticPurchasingSnapshot(
  value: unknown,
): AutomaticPurchasingSnapshot {
  const x = value as AutomaticPurchasingSnapshot;
  if (
    !x ||
    !Number.isSafeInteger(x.version) ||
    x.version < 0 ||
    typeof x.enabled !== "boolean" ||
    (x.enabled && !x.policy)
  )
    throw new Error("AUTOMATIC_POLICY_RESPONSE_INVALID");
  if (
    x.policy &&
    (!/^[1-9][0-9]*$/.test(x.policy.maxAutomaticAmount) ||
      !Number.isFinite(Date.parse(x.policy.expiresAt)) ||
      ![x.policy.suppliers, x.policy.itemIds].every(
        (list) =>
          Array.isArray(list) && list.every((item) => typeof item === "string"),
      ))
  )
    throw new Error("AUTOMATIC_POLICY_RESPONSE_INVALID");
  if (x.policy !== null && typeof x.policy !== "object")
    throw new Error("AUTOMATIC_POLICY_RESPONSE_INVALID");
  return x;
}
export function automaticPurchasingError(cause: unknown) {
  if (cause instanceof OperatorApiError) {
    if (cause.status === 404)
      return {
        status: "Not connected",
        message:
          "Purchasing controls could not be reached. Try again when the service is available.",
      };
    if (cause.status === 401)
      return {
        status: "Sign in again",
        message:
          "Your session has expired. Sign in again to view purchasing rules.",
      };
    if (cause.status === 403)
      return {
        status: "Access required",
        message: "Your clinic role does not allow access to purchasing rules.",
      };
  }
  return {
    status: "Unavailable",
    message: "Purchasing rules could not be loaded. Try again.",
  };
}
