export type MonitorStateFailure = {
  code: string;
};

export async function persistFailureState(
  admin: any,
  monitorKey: string,
  failure: MonitorStateFailure,
  now = new Date().toISOString(),
): Promise<void> {
  const { error } = await admin
    .from("hubspot_marketing_contact_monitor_state")
    .update({
      last_error_code: failure.code,
      last_error_at: now,
      updated_at: now,
    })
    .eq("monitor_key", monitorKey);

  if (error) throw error;
}
