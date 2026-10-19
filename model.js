// One inference implementation shared by the website and numerical verification.
export function formatProbability(p) {
  if (p <= 0.0005) return '<0.1%';
  if (p >= 0.9995) return '>99.9%';
  return `${(100 * p).toFixed(1)}%`;
}

export function predict(model, customer) {
  let values = model.inputs.map(name => {
    const raw = customer[name];
    if (raw === '' || raw === null || raw === undefined) throw new Error(`Missing ${name}.`);
    const x = Number(raw);
    if (!Number.isFinite(x)) throw new Error(`Invalid ${name}.`);
    const scale = model.scaling[name];
    if (scale && (!Number.isFinite(scale.mean) || !Number.isFinite(scale.std) || scale.std <= 0)) throw new Error(`Invalid scaling for ${name}.`);
    const scaled = scale ? (x - scale.mean) / scale.std : x;
    if (!Number.isFinite(scaled)) throw new Error(`The entered value for ${name} is too large to calculate reliably.`);
    return scaled;
  });
  for (const layer of model.layers) {
    values = layer.bias.map((bias, j) => {
      let z = bias;
      for (let i = 0; i < values.length; i++) z += values[i] * layer.weights[i][j];
      if (!Number.isFinite(z)) throw new Error('The entered values are too large to calculate reliably.');
      if (layer.activation === 'relu') return Math.max(0, z);
      if (layer.activation === 'sigmoid') {
        return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
      }
      throw new Error(`Unsupported activation: ${layer.activation}`);
    });
  }
  const p = values[0];
  if (values.length !== 1 || !Number.isFinite(p) || p < 0 || p > 1) throw new Error('Invalid model output.');
  return p;
}

export function parseCSV(text) {
  const records = [];
  let record = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quoted = false;
      else if (c === undefined) throw new Error('Unclosed CSV quote.');
      else value += c;
    } else if (c === '"' && value === '') quoted = true;
    else if (c === ',' || c === '\n' || c === undefined) {
      record.push(value); value = '';
      if (c !== ',') {
        if (record.some(v => v !== '')) records.push(record);
        record = [];
      }
    } else value += c;
  }
  const headers = records.shift();
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error('Invalid CSV headers.');
  return records.map(row => {
    if (row.length !== headers.length) throw new Error('Invalid CSV row.');
    return Object.fromEntries(headers.map((name, i) => [name, row[i]]));
  });
}

export function scoreCustomers(model, rows) {
  if (rows.length !== 1000 || new Set(rows.map(row => row.ID)).size !== 1000) {
    throw new Error('Expected 1,000 unique test customers.');
  }
  let maxError = 0;
  const scored = rows.map((row, originalIndex) => {
    const p = predict(model, row);
    const reference = Number(row.p_nn_reference);
    if (!Number.isFinite(reference) || row.p_nn_reference === '') throw new Error('Missing reference probability.');
    maxError = Math.max(maxError, Math.abs(p - reference));
    if (!['0', '1'].includes(row.accepted_loan)) throw new Error('Invalid historical outcome.');
    return {...row, p, originalIndex};
  });
  scored.sort((a, b) => b.p - a.p || a.originalIndex - b.originalIndex);
  return {scored, maxError, passed: maxError < 0.00001};
}

export function shortlistCSV(model, scored) {
  const headers = ['Rank', 'ID', ...model.inputs, 'Predicted probability'];
  const rows = scored.slice(0, 100).map((row, i) => [i + 1, row.ID, ...model.inputs.map(c => row[c]), row.p.toPrecision(16)]);
  return [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n') + '\r\n';
}
