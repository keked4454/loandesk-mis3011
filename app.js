import {predict, parseCSV, scoreCustomers, shortlistCSV, formatProbability} from './model.js';

const $ = id => document.getElementById(id);
const percent = formatProbability;
const education = {'1': 'Undergraduate', '2': 'Graduate', '3': 'Advanced / Prof.'};
const PAGE_SIZE = 10;
let model, scored = [], mode = 'priority', page = 0, selectedID = null, ready = false, loading = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderList() {
  const cohort = mode === 'priority' ? scored.slice(0, 100) : scored;
  const search = $('search').value.trim();
  const filtered = cohort.filter(row => String(row.ID).includes(search));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(page, pages - 1);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const tbody = $('customer-rows');
  tbody.replaceChildren();
  for (const row of visible) {
    const rank = row.rank;
    const tr = el('tr');
    if (selectedID === row.ID) tr.classList.add('selected');
    tr.append(el('td', String(rank).padStart(2, '0'), rank <= 100 ? 'rank priority' : 'rank'));
    const customer = el('td');
    const button = el('button', `ID ${row.ID}`, 'customer-button');
    button.type = 'button';
    button.setAttribute('aria-label', `Inspect customer ${row.ID}, rank ${rank}`);
    button.setAttribute('aria-pressed', String(selectedID === row.ID));
    button.setAttribute('aria-controls', 'predict-form');
    button.addEventListener('click', () => selectCustomer(row));
    customer.append(button);
    if (rank <= 100) customer.append(el('span', 'PRIORITY', 'customer-id'));
    tr.append(customer, el('td', `$${Number(row.Income).toLocaleString('en-US')}`), el('td', education[row.Education], 'education'));
    const probability = el('td');
    const wrapper = el('div', undefined, 'prob-cell');
    const bar = el('div', undefined, 'prob-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span');
    fill.style.width = `${100 * row.p}%`;
    bar.append(fill);
    wrapper.append(bar, el('span', percent(row.p), 'prob-number'));
    probability.title = `${(row.p * 100).toFixed(6)}% (model estimate)`;
    probability.append(wrapper);
    tr.append(probability);
    tbody.append(tr);
  }
  if (!visible.length) {
    const td = el('td', 'No customers match this ID in the selected list.', 'empty');
    td.colSpan = 5;
    const tr = el('tr'); tr.append(td); tbody.append(tr);
  }
  $('list-count').textContent = filtered.length ? `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length} customers` : '0 matching customers';
  $('page-label').textContent = `${page + 1} / ${pages}`;
  $('prev').disabled = page === 0;
  $('next').disabled = page >= pages - 1;
  for (const [id, active] of [['priority-tab', mode === 'priority'], ['all-tab', mode === 'all']]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
}

function showPrediction(customer, caption) {
  const p = predict(model, customer);
  $('prediction-caption').textContent = caption;
  $('prediction-value').textContent = percent(p);
  const cutoff = scored[99].p;
  $('prediction-note').textContent = p >= cutoff
    ? `At or above the current priority cutoff of ${percent(cutoff)}. This is a model estimate, not a guaranteed acceptance.`
    : `Below the current priority cutoff of ${percent(cutoff)}. This is a model estimate, not a guaranteed acceptance.`;
  $('prediction').hidden = false;
}

function invalidatePrediction() {
  const hadPrediction = !$('prediction').hidden;
  $('prediction').hidden = true;
  if (hadPrediction) $('prediction-hint').hidden = false;
  if (selectedID !== null) {
    selectedID = null;
    if (ready) renderList();
  }
}

function selectCustomer(row) {
  selectedID = row.ID;
  for (const name of model.inputs) $('predict-form').elements.namedItem(name).value = row[name];
  showPrediction(row, `Estimated acceptance · Customer ${row.ID}`);
  $('prediction-hint').hidden = true;
  renderList();
  if (window.matchMedia('(max-width: 760px)').matches) $('customer-form').scrollIntoView({behavior: 'auto', block: 'start'});
}

function showEvaluation(metrics) {
  const rows = $('evaluation-rows');
  rows.replaceChildren();
  for (const result of metrics.table_a) {
    const tr = el('tr');
    tr.append(el('td', result.Model), el('td', Number(result['Test AUC']).toFixed(3)), el('td', String(result['Accepted, out of 100 calls'])));
    rows.append(tr);
  }
  const accepted = scored.slice(0, 100).reduce((n, row) => n + Number(row.accepted_loan), 0);
  const total = scored.reduce((n, row) => n + Number(row.accepted_loan), 0);
  const random = 100 * total / scored.length;
  $('backtest-note').textContent = `In this held-out cohort, ${total} of ${scored.length.toLocaleString('en-US')} customers accepted. The neural network reaches ${accepted} with 100 calls; random selection would reach about ${random.toFixed(1)} on average (${(accepted / random).toFixed(1)}× lift). Table A rounds the random count to an integer.`;
}

for (const [id, newMode] of [['priority-tab', 'priority'], ['all-tab', 'all']]) {
  $(id).addEventListener('click', () => { if (ready) { mode = newMode; page = 0; renderList(); } });
}
$('search').addEventListener('input', () => { if (ready) { page = 0; renderList(); } });
$('prev').addEventListener('click', () => { page--; renderList(); });
$('next').addEventListener('click', () => { page++; renderList(); });
$('predict-form').addEventListener('input', invalidatePrediction);
$('predict-form').addEventListener('change', invalidatePrediction);
$('predict-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!ready || !$('predict-form').reportValidity()) return;
  const customer = Object.fromEntries(new FormData(event.currentTarget));
  try {
    selectedID = null;
    showPrediction(customer, 'Estimated loan acceptance');
    $('prediction-hint').hidden = true;
    renderList();
  } catch (error) {
    $('prediction-hint').hidden = true;
    $('prediction').hidden = false;
    $('prediction-caption').textContent = 'Check the customer details';
    $('prediction-value').textContent = '—';
    $('prediction-note').textContent = error.message;
  }
});
$('reset-form').addEventListener('click', () => {
  $('predict-form').reset(); selectedID = null; $('prediction').hidden = true; $('prediction-hint').hidden = true;
  if (ready) renderList();
});
$('download').addEventListener('click', () => {
  if (!ready) return;
  const url = URL.createObjectURL(new Blob([shortlistCSV(model, scored)], {type: 'text/csv;charset=utf-8'}));
  const link = el('a'); link.href = url; link.download = 'LoanDesk_priority_100.csv';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('retry-load').addEventListener('click', () => load());

async function load() {
  if (loading) return;
  loading = true;
  ready = false;
  $('load-error').hidden = true;
  $('retry-load').disabled = true;
  $('download').disabled = true;
  $('predict-button').disabled = true;
  $('check-icon').textContent = '…';
  $('check-title').textContent = 'Checking prediction consistency';
  $('check-detail').textContent = 'Comparing every browser prediction with the Python reference.';
  document.querySelector('.verification').classList.remove('failed');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const responses = await Promise.all(['model_nn.json', 'customers_test.csv', 'campaign_metrics.json'].map(path => fetch(path, {signal: controller.signal, cache: 'no-store'})));
    if (responses.some(response => !response.ok)) throw new Error('Could not load the campaign files. Check your connection and try again.');
    const [modelData, customerText, metrics] = await Promise.all([responses[0].json(), responses[1].text(), responses[2].json()]);
    model = modelData;
    const audit = scoreCustomers(model, parseCSV(customerText));
    $('check-detail').textContent = `${audit.scored.length.toLocaleString('en-US')} customers checked · Max absolute difference: ${audit.maxError.toExponential(3)} · Required: < 0.00001`;
    if (!audit.passed) throw new Error('Prediction consistency failed. The call list is unavailable until model and data files agree.');
    scored = audit.scored.map((row, i) => ({...row, rank: i + 1}));
    const accepted = scored.slice(0, 100).reduce((n, row) => n + Number(row.accepted_loan), 0);
    const metric = metrics.table_a.find(row => row.Model === 'Neural network');
    if (!metric || metric['Accepted, out of 100 calls'] !== accepted) throw new Error('Historical metrics do not match this model export.');
    const expected = scored.slice(0, 100).reduce((n, row) => n + row.p, 0);
    $('ranked-count').textContent = scored.length.toLocaleString('en-US');
    $('priority-score').textContent = percent(expected / 100);
    $('expected-count').textContent = expected.toFixed(1);
    renderList(); showEvaluation(metrics);
    ready = true;
    $('download').disabled = false; $('predict-button').disabled = false;
    $('check-icon').textContent = '✓'; $('check-title').textContent = 'Prediction consistency check passed';
  } catch (error) {
    ready = false;
    $('load-error-message').textContent = error.name === 'AbortError' ? 'Loading timed out. Check your connection and try again.' : error.message;
    $('load-error').hidden = false;
    $('check-title').textContent = 'Prediction check incomplete'; $('check-icon').textContent = '!';
    document.querySelector('.verification').classList.add('failed');
    $('customer-rows').replaceChildren();
    const td = el('td', 'Campaign data could not be verified.', 'empty'); td.colSpan = 5;
    const tr = el('tr'); tr.append(td); $('customer-rows').append(tr);
    $('prev').disabled = true; $('next').disabled = true;
    $('list-count').textContent = 'Customer data unavailable';
    $('page-label').textContent = '—';
    $('evaluation-rows').replaceChildren();
    $('backtest-note').textContent = '';
    for (const id of ['ranked-count', 'priority-score', 'expected-count']) $(id).textContent = '—';
  } finally {
    clearTimeout(timeout);
    loading = false;
    $('retry-load').disabled = false;
  }
}
load();
