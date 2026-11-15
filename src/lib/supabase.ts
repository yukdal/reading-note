import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// 둘 다 있을 때만 실제 클라이언트를 만든다. 없으면 null -> App.tsx가 데모 모드로 분기.
// PKCE: 앱이 해시 라우팅(#/books/...)을 쓰므로, 인증 콜백이 URL 해시가 아니라
// code= 쿼리 파라미터로 오는 PKCE 방식이어야 라우팅과 충돌하지 않는다.
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } }) : null;
