// js/auth/auth.js
import { supabase } from '../lib/supabase.js';

const $ = (id) => document.getElementById(id);
const msg = (t, ok = false) => {
  $('msg').textContent = t;
  $('msg').className = `text-center text-sm mt-4 ${ok ? 'text-emerald-400' : 'text-rose-400'}`;
};

// Si ya hay sesion, ir al dashboard
supabase.auth.getSession().then(({ data }) => {
  if (data.session) location.href = '/dashboard.html';
});

$('loginBtn').addEventListener('click', async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value,
  });
  if (error) return msg(error.message);
  location.href = '/dashboard.html';
});

$('registerBtn').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!email || !password) return msg('Completa correo y contrasena');

  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { username } },
  });
  if (error) return msg(error.message);
  msg('Cuenta creada. Revisa tu correo si la confirmacion esta activada, o inicia sesion.', true);
});
