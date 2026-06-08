const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function serialize(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); }
  catch(e) { return String(value); }
}

function write(level, scope, args) {
  if (LEVELS[level] > currentLevel) return;
  const prefix = '[' + new Date().toISOString() + '] [' + level.toUpperCase() + '] [' + scope + ']';
  const line = [prefix].concat(args.map(serialize)).join(' ');
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function createLogger(scope) {
  const name = scope || 'app';
  return {
    error: function() { write('error', name, Array.from(arguments)); },
    warn: function() { write('warn', name, Array.from(arguments)); },
    info: function() { write('info', name, Array.from(arguments)); },
    debug: function() { write('debug', name, Array.from(arguments)); },
    child: function(childScope) { return createLogger(name + ':' + childScope); }
  };
}

module.exports = createLogger;
