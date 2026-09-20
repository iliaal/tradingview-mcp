import { register } from '../router.js';
import * as core from '../../core/alerts.js';

register('alert', {
  description: 'Alert tools (list, create, delete)',
  subcommands: new Map([
    ['list', {
      description: 'List active alerts',
      handler: () => core.list(),
    }],
    ['create', {
      description: 'Create a price alert',
      options: {
        price: { type: 'string', short: 'p', description: 'Price level' },
        condition: { type: 'string', short: 'c', description: 'crossing | greater_than/above/cross_up | less_than/below/cross_down. For a stop-loss use cross_down/cross_up — plain crossing fires in BOTH directions' },
        message: { type: 'string', short: 'm', description: 'Alert message' },
        name: { type: 'string', short: 'n', description: 'Alert name (shown in TradingView\'s Alert name field)' },
        webhook: { type: 'string', short: 'w', description: 'Webhook URL. WITHOUT THIS THE ALERT DISPATCHES NOTHING — it fires and shows a popup, but sends no request' },
        email: { type: 'boolean', short: 'e', description: 'Also send the email notification (default false)' },
        frequency: { type: 'string', short: 'f', description: 'How often the alert may fire (default on_first_fire)' },
        expiration: { type: 'string', short: 'x', description: 'Days until expiry, or "never" for open-ended (default 30)' },
        'keep-active': { type: 'boolean', description: 'Do NOT auto-deactivate after firing (use with cross_up/cross_down so it re-arms)' },
      },
      handler: (opts) => core.create({
        price: Number(opts.price),
        condition: opts.condition || 'crossing',
        message: opts.message,
        name: opts.name,
        webhook: opts.webhook,
        email: opts.email,
        frequency: opts.frequency,
        expiration: opts.expiration,
        auto_deactivate: opts['keep-active'] ? false : undefined,
      }),
    }],
    ['delete', {
      description: 'Delete alerts',
      options: {
        all: { type: 'boolean', description: 'Delete all alerts' },
      },
      handler: (opts) => core.deleteAlerts({ delete_all: opts.all }),
    }],
  ]),
});
