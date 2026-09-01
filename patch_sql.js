const fs = require('fs');
let code = fs.readFileSync('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', 'utf8');

const oldCheck = `  if v_decision = 'reserved' and v_request_id is not null then
    insert into public.whatsapp_outbound_payloads (
      request_id,
      ciphertext,
      iv,
      key_version,
      state,
      expires_at,
      created_at,
      updated_at
    ) values (
      v_request_id,
      p_ciphertext,
      p_iv,
      p_key_version,
      'queued',
      pg_catalog.clock_timestamp() + interval '1 hour',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    );
  end if;`;

const newCheck = `  if (v_decision = 'reserved' or (v_decision = 'duplicate' and v_request_status = 'reserved')) and v_request_id is not null then
    insert into public.whatsapp_outbound_payloads (
      request_id,
      ciphertext,
      iv,
      key_version,
      state,
      expires_at,
      created_at,
      updated_at
    ) values (
      v_request_id,
      p_ciphertext,
      p_iv,
      p_key_version,
      'queued',
      pg_catalog.clock_timestamp() + interval '1 hour',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    ) on conflict (request_id) do nothing;
  end if;`;

code = code.replace(oldCheck, newCheck);
fs.writeFileSync('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', code);
