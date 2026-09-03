export type MonitorStateFailure = {
  code: string;
};

export async function persistFailureState(
  admin: any,
  monitorKey: string,
  failure: MonitorStateFailure,
  now = new Date().toISOString(),
): Promise<void> {
  const { data, error } = await admin
    .from("hubspot_marketing_contact_monitor_state")
    .update({
      last_error_code: failure.code,
      last_error_at: now,
      updated_at: now,
    })
    .eq("monitor_key", monitorKey)
    .select("monitor_key");

  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.monitor_key !== monitorKey) {
    throw new Error("HubSpot monitor failure-state persistence affected an unexpected row count");
  }
}
