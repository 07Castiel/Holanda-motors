/**
 * data.js — Camada de dados compartilhada (Holanda Motors)
 * -----------------------------------------------------------
 * Fonte única de verdade para o site público (index.html) e o
 * painel do gestor (admin.html). Os dois arquivos leem e escrevem
 * nas MESMAS chaves do localStorage através deste módulo, então
 * qualquer alteração feita no painel aparece automaticamente no site.
 *
 * Não há backend: tudo roda no navegador do usuário. Isso é
 * intencional para esta demo (ver README → Limitações), mas o
 * desenho deste módulo foi feito para que trocar localStorage por
 * chamadas a uma API real (ex: Supabase) no futuro exija mexer
 * apenas aqui — nunca no site.js ou no admin.js.
 */

const HM = (function () {
  'use strict';

  const KEYS = {
    vehicles: 'hm_vehicles',
    consig: 'hm_consig',
    activity: 'hm_activity',
    config: 'hm_config',
    pass: 'hm_pass',
  };

  const DEFAULT_PASS = 'holanda2026';

  const DEFAULT_VEHICLES = [
    { id: 1, tipo: 'carro', make: 'Jeep', model: 'Renegade Sport', year: 2023, km: 18400, price: 'R$ 119.900', cambio: 'Automático', combustivel: 'Flex', cor: 'Branco', badge: 'destaque', ativo: 1, img: 'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=700&q=80', desc: 'Único dono, revisões em concessionária, IPVA 2026 pago.' },
    { id: 2, tipo: 'carro', make: 'Chevrolet', model: 'Onix Plus Premier', year: 2022, km: 31200, price: 'R$ 84.500', cambio: 'Automático', combustivel: 'Flex', cor: 'Azul', badge: 'seminovo', ativo: 1, img: 'https://images.unsplash.com/photo-1590362891991-f776e747a588?w=600&q=80', desc: '' },
    { id: 3, tipo: 'carro', make: 'Audi', model: 'A1 Sportback', year: 2020, km: 48700, price: 'R$ 139.000', cambio: 'Automático', combustivel: 'Gasolina', cor: 'Branco', badge: 'seminovo', ativo: 1, img: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&q=80', desc: '' },
    { id: 4, tipo: 'moto', make: 'Honda', model: 'CB 650R', year: 2022, km: 9800, price: 'R$ 49.800', cambio: 'Manual', combustivel: 'Gasolina', cor: 'Azul / Preto', badge: 'seminovo', ativo: 1, img: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=600&q=80', desc: '' },
    { id: 5, tipo: 'carro', make: 'Toyota', model: 'Corolla XEI', year: 2021, km: 57300, price: 'R$ 128.000', cambio: 'Automático', combustivel: 'Flex', cor: 'Prata', badge: 'consignado', ativo: 1, img: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=600&q=80', desc: '' },
    { id: 6, tipo: 'moto', make: 'Honda', model: 'CB 500F', year: 2021, km: 14200, price: 'R$ 32.900', cambio: 'Manual', combustivel: 'Gasolina', cor: 'Verde / Preto', badge: 'consignado', ativo: 1, img: 'https://images.unsplash.com/photo-1449426468159-d96dbf08f19f?w=600&q=80', desc: '' },
    { id: 7, tipo: 'carro', make: 'Hyundai', model: 'HB20S Vision', year: 2023, km: 12100, price: 'R$ 78.500', cambio: 'Automático', combustivel: 'Flex', cor: 'Vermelho', badge: 'seminovo', ativo: 1, img: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=600&q=80', desc: '' },
    { id: 8, tipo: 'moto', make: 'Yamaha', model: 'MT-03', year: 2022, km: 7400, price: 'R$ 38.200', cambio: 'Manual', combustivel: 'Gasolina', cor: 'Cinza / Amarelo', badge: 'seminovo', ativo: 1, img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80', desc: '' },
  ];

  const DEFAULT_CONSIG = [
    { id: 1, owner: 'Marcos Oliveira', contact: '(85) 98876-5432', vehicle: 'Toyota Hilux SW4 2020', plate: 'QRS-9012', value: 'R$ 210.000', date: '2026-07-15', status: 'ativo', commission: '5%', notes: 'Proprietário viajará em agosto, quer vender antes.' },
    { id: 2, owner: 'Fernanda Lima', contact: '(88) 99654-3210', vehicle: 'Honda CB 300R 2022', plate: 'TUV-3456', value: 'R$ 21.500', date: '2026-07-28', status: 'negociando', commission: 'R$ 1.000', notes: '' },
  ];

  const DEFAULT_CONFIG = {
    name: 'Holanda Motors',
    address: 'Av. Lúcia Sabóia, nº 240, Centro, Sobral - CE, 62010-830',
    wpp: '5585997576262',
    insta: '@holanda_motors',
    h1: '08h às 18h',
    h2: '08h às 13h',
    about: 'Carros e motos seminovos com qualidade de showroom, atendimento transparente e o melhor preço de Sobral.',
    hero: true,
    consig: true,
    floatwpp: true,
    nophoto: false,
  };

  /** Lê uma chave do localStorage com fallback seguro (nunca lança erro para a UI). */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.error(`[HM] Falha ao ler "${key}" do localStorage — usando valor padrão.`, err);
      return fallback;
    }
  }

  /** Escreve uma chave no localStorage. Retorna false se falhar (ex: quota excedida). */
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error(`[HM] Falha ao salvar "${key}" no localStorage.`, err);
      return false;
    }
  }

  function getVehicles() {
    return read(KEYS.vehicles, DEFAULT_VEHICLES);
  }
  function saveVehicles(list) {
    return write(KEYS.vehicles, list);
  }
  function getConsigs() {
    return read(KEYS.consig, DEFAULT_CONSIG);
  }
  function saveConsigs(list) {
    return write(KEYS.consig, list);
  }
  function getConfig() {
    // merge com o padrão para que campos novos adicionados no futuro
    // sempre tenham um valor, mesmo em navegadores com config antiga salva
    return Object.assign({}, DEFAULT_CONFIG, read(KEYS.config, {}));
  }
  function saveConfig(cfg) {
    return write(KEYS.config, cfg);
  }
  function getPass() {
    return localStorage.getItem(KEYS.pass) || DEFAULT_PASS;
  }
  function setPass(newPass) {
    localStorage.setItem(KEYS.pass, newPass);
  }
  function getActivity() {
    return read(KEYS.activity, []);
  }
  function logActivity(msg, color) {
    const acts = read(KEYS.activity, []);
    acts.unshift({
      msg,
      color,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    });
    write(KEYS.activity, acts.slice(0, 20));
  }

  /** Monta o link do WhatsApp (wa.me) já com a mensagem pré-preenchida. */
  function wppLink(message, wppNumber) {
    const number = wppNumber || getConfig().wpp;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }

  /** Formata km com separador de milhar em pt-BR (ex: 18400 → "18.400 km"). */
  function formatKm(n) {
    return Number(n || 0).toLocaleString('pt-BR') + ' km';
  }

  return {
    KEYS,
    DEFAULT_PASS,
    DEFAULT_VEHICLES,
    DEFAULT_CONSIG,
    DEFAULT_CONFIG,
    getVehicles,
    saveVehicles,
    getConsigs,
    saveConsigs,
    getConfig,
    saveConfig,
    getPass,
    setPass,
    getActivity,
    logActivity,
    wppLink,
    formatKm,
  };
})();
