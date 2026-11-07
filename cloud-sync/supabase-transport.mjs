/** Adapter for the official Supabase client. A signed-in athlete session is
 * mandatory. Provision the project and database migration before activation.
 * Inject a pinned, locally bundled createClient instance; NEVER a service-role
 * or management key. This file intentionally contains no account credentials.
 */
export function createSupabaseTransport(client, {userId, planId}) {
  if (!client?.rpc || !userId || !planId) throw new Error('Online-Speicher nicht verbunden.');
  return {
    async exchange(changes) {
      const {data: sessionData, error: authError} = await client.auth.getSession();
      if (authError || sessionData?.session?.user?.id !== userId) {
        throw new Error('Bitte den persönlichen Zugang auf diesem Gerät öffnen.');
      }
      const {data, error} = await client.rpc('pista_exchange', {
        p_plan: planId, p_changes: changes
      });
      if (error) throw new Error('Online-Abgleich fehlgeschlagen. Änderungen bleiben auf diesem Gerät vorgemerkt.');
      return {rows: data};
    },
    subscribe(onChange) {
      const channel = client.channel('pista-progress-' + planId)
        .on('postgres_changes', {event: '*', schema: 'public', table: 'pista_progress',
          filter: 'owner_id=eq.' + userId}, onChange)
        .subscribe(status => {if (status === 'SUBSCRIBED') onChange();});
      return () => {void client.removeChannel(channel);};
    }
  };
}
