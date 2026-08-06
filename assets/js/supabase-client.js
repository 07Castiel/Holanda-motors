/**
 * supabase-client.js — configuração e instância única do client Supabase.
 * Carregado ANTES de data.js em index.html e admin/index.html (que por sua vez
 * é carregado antes do supabase-js via CDN, veja a ordem de <script> no HTML).
 *
 * A "anon key" abaixo é pública por desenho do Supabase — a segurança real
 * vem das políticas de RLS definidas em supabase/schema.sql, não do sigilo
 * desta chave. Troque os dois valores abaixo pelos do SEU projeto (veja
 * README.md → "Configurando o Supabase do zero").
 */
const SUPABASE_URL = 'https://bqtfnnglwampyijmwdgm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vaitarKonQCntB4mmzltLg_UMYpWaV3';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
