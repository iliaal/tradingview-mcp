import { register } from '../router.js';
import * as core from '../../core/hotlist.js';

register('hotlist', {
  description: 'Fetch a TradingView US hotlist (dynamic scanner preset) by slug',
  options: {
    limit: { type: 'string', short: 'n', description: 'Cap returned symbols (default 20, max 20)' },
  },
  handler: (opts, positionals) => {
    const slug = positionals[0];
    if (!slug) {
      throw new Error(`Slug required. Usage: tv hotlist <slug>\nKnown slugs: ${core.HOTLIST_SLUGS.join(', ')}`);
    }
    return core.getHotlist({
      slug,
      limit: opts.limit ? Number(opts.limit) : undefined,
    });
  },
});
