import { register } from '../router.js';
import * as core from '../../core/drawing.js';

const TYPES_HELP = `Shape type. 1-point: ${core.SHAPE_TYPES.one_point.join(', ')}. 2-point: ${core.SHAPE_TYPES.two_point.join(', ')}. N-point (--points): ${core.SHAPE_TYPES.multi_point.join(', ')}. Any other TradingView line-tool name is passed through.`;

register('draw', {
  description: 'Drawing tools (shape, position, move, set, hide, show, list, get, remove, clear)',
  subcommands: new Map([
    ['shape', {
      description: 'Draw a shape on the chart (line, box, fib, volume profile, position, ...)',
      options: {
        type: { type: 'string', short: 't', description: TYPES_HELP },
        price: { type: 'string', short: 'p', description: 'Price level (first point)' },
        time: { type: 'string', description: 'Unix timestamp (first point)' },
        price2: { type: 'string', description: 'Second point price (two-point shapes)' },
        time2: { type: 'string', description: 'Second point time (two-point shapes)' },
        points: { type: 'string', description: 'JSON array of {time, price} — overrides --price/--time; use for 3+ point shapes' },
        text: { type: 'string', description: 'Text content (text, note, rectangle label, ...)' },
        overrides: { type: 'string', description: 'JSON style overrides (keys from `draw get <id>` → properties)' },
      },
      handler: (opts) => {
        const point = opts.points ? undefined : { time: Number(opts.time), price: Number(opts.price) };
        const point2 = !opts.points && opts.price2 ? { time: Number(opts.time2), price: Number(opts.price2) } : undefined;
        return core.drawShape({ shape: opts.type || 'horizontal_line', point, point2, points: opts.points, overrides: opts.overrides, text: opts.text });
      },
    }],
    ['position', {
      description: 'Draw a long/short position box from entry, stop and target prices (R multiple reported)',
      options: {
        side: { type: 'string', short: 's', description: 'long | short (default long)' },
        entry: { type: 'string', short: 'e', description: 'Entry price' },
        stop: { type: 'string', description: 'Stop price' },
        target: { type: 'string', description: 'Target price' },
        time: { type: 'string', description: 'Unix timestamp of the entry (box start)' },
        time2: { type: 'string', description: 'Box end timestamp (default: time + 1 day)' },
        text: { type: 'string', description: 'Label' },
      },
      handler: (opts) => core.drawPosition({ side: opts.side, entry: opts.entry, stop: opts.stop, target: opts.target, time: opts.time, time2: opts.time2, text: opts.text }),
    }],
    ['move', {
      description: 'Move a drawing: draw move <id> --points \'[{"time":..,"price":..}]\'',
      options: { points: { type: 'string', description: 'JSON array of {time, price}' } },
      handler: (opts, positionals) => core.movePoints({ entity_id: positionals[0], points: opts.points }),
    }],
    ['set', {
      description: 'Change properties of a drawing: draw set <id> --props \'{"linecolor":"#f00"}\'',
      options: { props: { type: 'string', description: 'JSON object of properties (deep-merged)' } },
      handler: (opts, positionals) => core.setProperties({ entity_id: positionals[0], properties: opts.props }),
    }],
    ['hide', {
      description: 'Hide a drawing without deleting it',
      handler: (opts, positionals) => core.setVisible({ entity_id: positionals[0], visible: false }),
    }],
    ['show', {
      description: 'Show a hidden drawing',
      handler: (opts, positionals) => core.setVisible({ entity_id: positionals[0], visible: true }),
    }],
    ['list', {
      description: 'List all drawings on the chart',
      handler: () => core.listDrawings(),
    }],
    ['get', {
      description: 'Get properties of a drawing',
      handler: (opts, positionals) => core.getProperties({ entity_id: positionals[0] }),
    }],
    ['remove', {
      description: 'Remove a drawing by entity ID',
      handler: (opts, positionals) => core.removeOne({ entity_id: positionals[0] }),
    }],
    ['clear', {
      description: 'Remove all drawings',
      handler: () => core.clearAll(),
    }],
  ]),
});
