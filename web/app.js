"use strict";
(() => {
  // node_modules/js-yaml/dist/js-yaml.mjs
  function getDefaultExportFromCjs(x) {
    return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
  }
  var jsYaml = {};
  var loader = {};
  var common = {};
  var hasRequiredCommon;
  function requireCommon() {
    if (hasRequiredCommon) return common;
    hasRequiredCommon = 1;
    function isNothing(subject) {
      return typeof subject === "undefined" || subject === null;
    }
    function isObject(subject) {
      return typeof subject === "object" && subject !== null;
    }
    function toArray(sequence) {
      if (Array.isArray(sequence)) return sequence;
      else if (isNothing(sequence)) return [];
      return [sequence];
    }
    function extend(target, source2) {
      if (source2) {
        const sourceKeys = Object.keys(source2);
        for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
          const key = sourceKeys[index];
          target[key] = source2[key];
        }
      }
      return target;
    }
    function repeat(string, count) {
      let result = "";
      for (let cycle = 0; cycle < count; cycle += 1) {
        result += string;
      }
      return result;
    }
    function isNegativeZero(number) {
      return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
    }
    common.isNothing = isNothing;
    common.isObject = isObject;
    common.toArray = toArray;
    common.repeat = repeat;
    common.isNegativeZero = isNegativeZero;
    common.extend = extend;
    return common;
  }
  var exception;
  var hasRequiredException;
  function requireException() {
    if (hasRequiredException) return exception;
    hasRequiredException = 1;
    function formatError(exception2, compact) {
      let where = "";
      const message = exception2.reason || "(unknown reason)";
      if (!exception2.mark) return message;
      if (exception2.mark.name) {
        where += 'in "' + exception2.mark.name + '" ';
      }
      where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
      if (!compact && exception2.mark.snippet) {
        where += "\n\n" + exception2.mark.snippet;
      }
      return message + " " + where;
    }
    function YAMLException2(reason, mark) {
      Error.call(this);
      this.name = "YAMLException";
      this.reason = reason;
      this.mark = mark;
      this.message = formatError(this, false);
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
      } else {
        this.stack = new Error().stack || "";
      }
    }
    YAMLException2.prototype = Object.create(Error.prototype);
    YAMLException2.prototype.constructor = YAMLException2;
    YAMLException2.prototype.toString = function toString(compact) {
      return this.name + ": " + formatError(this, compact);
    };
    exception = YAMLException2;
    return exception;
  }
  var snippet;
  var hasRequiredSnippet;
  function requireSnippet() {
    if (hasRequiredSnippet) return snippet;
    hasRequiredSnippet = 1;
    const common2 = requireCommon();
    function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
      let head = "";
      let tail = "";
      const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
      if (position - lineStart > maxHalfLength) {
        head = " ... ";
        lineStart = position - maxHalfLength + head.length;
      }
      if (lineEnd - position > maxHalfLength) {
        tail = " ...";
        lineEnd = position + maxHalfLength - tail.length;
      }
      return {
        str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
        pos: position - lineStart + head.length
        // relative position
      };
    }
    function padStart(string, max) {
      return common2.repeat(" ", max - string.length) + string;
    }
    function makeSnippet(mark, options) {
      options = Object.create(options || null);
      if (!mark.buffer) return null;
      if (!options.maxLength) options.maxLength = 79;
      if (typeof options.indent !== "number") options.indent = 1;
      if (typeof options.linesBefore !== "number") options.linesBefore = 3;
      if (typeof options.linesAfter !== "number") options.linesAfter = 2;
      const re = /\r?\n|\r|\0/g;
      const lineStarts = [0];
      const lineEnds = [];
      let match;
      let foundLineNo = -1;
      while (match = re.exec(mark.buffer)) {
        lineEnds.push(match.index);
        lineStarts.push(match.index + match[0].length);
        if (mark.position <= match.index && foundLineNo < 0) {
          foundLineNo = lineStarts.length - 2;
        }
      }
      if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
      let result = "";
      const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
      const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
      for (let i = 1; i <= options.linesBefore; i++) {
        if (foundLineNo - i < 0) break;
        const line2 = getLine(
          mark.buffer,
          lineStarts[foundLineNo - i],
          lineEnds[foundLineNo - i],
          mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
          maxLineLength
        );
        result = common2.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
      }
      const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
      result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
      result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
      for (let i = 1; i <= options.linesAfter; i++) {
        if (foundLineNo + i >= lineEnds.length) break;
        const line2 = getLine(
          mark.buffer,
          lineStarts[foundLineNo + i],
          lineEnds[foundLineNo + i],
          mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
          maxLineLength
        );
        result += common2.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
      }
      return result.replace(/\n$/, "");
    }
    snippet = makeSnippet;
    return snippet;
  }
  var type;
  var hasRequiredType;
  function requireType() {
    if (hasRequiredType) return type;
    hasRequiredType = 1;
    const YAMLException2 = requireException();
    const TYPE_CONSTRUCTOR_OPTIONS = [
      "kind",
      "multi",
      "resolve",
      "construct",
      "instanceOf",
      "predicate",
      "represent",
      "representName",
      "defaultStyle",
      "styleAliases"
    ];
    const YAML_NODE_KINDS = [
      "scalar",
      "sequence",
      "mapping"
    ];
    function compileStyleAliases(map2) {
      const result = {};
      if (map2 !== null) {
        Object.keys(map2).forEach(function(style) {
          map2[style].forEach(function(alias) {
            result[String(alias)] = style;
          });
        });
      }
      return result;
    }
    function Type2(tag, options) {
      options = options || {};
      Object.keys(options).forEach(function(name) {
        if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
          throw new YAMLException2('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
        }
      });
      this.options = options;
      this.tag = tag;
      this.kind = options["kind"] || null;
      this.resolve = options["resolve"] || function() {
        return true;
      };
      this.construct = options["construct"] || function(data) {
        return data;
      };
      this.instanceOf = options["instanceOf"] || null;
      this.predicate = options["predicate"] || null;
      this.represent = options["represent"] || null;
      this.representName = options["representName"] || null;
      this.defaultStyle = options["defaultStyle"] || null;
      this.multi = options["multi"] || false;
      this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
      if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
        throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
      }
    }
    type = Type2;
    return type;
  }
  var schema;
  var hasRequiredSchema;
  function requireSchema() {
    if (hasRequiredSchema) return schema;
    hasRequiredSchema = 1;
    const YAMLException2 = requireException();
    const Type2 = requireType();
    function compileList(schema2, name) {
      const result = [];
      schema2[name].forEach(function(currentType) {
        let newIndex = result.length;
        result.forEach(function(previousType, previousIndex) {
          if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
            newIndex = previousIndex;
          }
        });
        result[newIndex] = currentType;
      });
      return result;
    }
    function compileMap() {
      const result = {
        scalar: {},
        sequence: {},
        mapping: {},
        fallback: {},
        multi: {
          scalar: [],
          sequence: [],
          mapping: [],
          fallback: []
        }
      };
      function collectType(type2) {
        if (type2.multi) {
          result.multi[type2.kind].push(type2);
          result.multi["fallback"].push(type2);
        } else {
          result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
        }
      }
      for (let index = 0, length = arguments.length; index < length; index += 1) {
        arguments[index].forEach(collectType);
      }
      return result;
    }
    function Schema2(definition) {
      return this.extend(definition);
    }
    Schema2.prototype.extend = function extend(definition) {
      let implicit = [];
      let explicit = [];
      if (definition instanceof Type2) {
        explicit.push(definition);
      } else if (Array.isArray(definition)) {
        explicit = explicit.concat(definition);
      } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
        if (definition.implicit) implicit = implicit.concat(definition.implicit);
        if (definition.explicit) explicit = explicit.concat(definition.explicit);
      } else {
        throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
      }
      implicit.forEach(function(type2) {
        if (!(type2 instanceof Type2)) {
          throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
        if (type2.loadKind && type2.loadKind !== "scalar") {
          throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
        }
        if (type2.multi) {
          throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
        }
      });
      explicit.forEach(function(type2) {
        if (!(type2 instanceof Type2)) {
          throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
      });
      const result = Object.create(Schema2.prototype);
      result.implicit = (this.implicit || []).concat(implicit);
      result.explicit = (this.explicit || []).concat(explicit);
      result.compiledImplicit = compileList(result, "implicit");
      result.compiledExplicit = compileList(result, "explicit");
      result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
      return result;
    };
    schema = Schema2;
    return schema;
  }
  var str;
  var hasRequiredStr;
  function requireStr() {
    if (hasRequiredStr) return str;
    hasRequiredStr = 1;
    const Type2 = requireType();
    str = new Type2("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function(data) {
        return data !== null ? data : "";
      }
    });
    return str;
  }
  var seq;
  var hasRequiredSeq;
  function requireSeq() {
    if (hasRequiredSeq) return seq;
    hasRequiredSeq = 1;
    const Type2 = requireType();
    seq = new Type2("tag:yaml.org,2002:seq", {
      kind: "sequence",
      construct: function(data) {
        return data !== null ? data : [];
      }
    });
    return seq;
  }
  var map;
  var hasRequiredMap;
  function requireMap() {
    if (hasRequiredMap) return map;
    hasRequiredMap = 1;
    const Type2 = requireType();
    map = new Type2("tag:yaml.org,2002:map", {
      kind: "mapping",
      construct: function(data) {
        return data !== null ? data : {};
      }
    });
    return map;
  }
  var failsafe;
  var hasRequiredFailsafe;
  function requireFailsafe() {
    if (hasRequiredFailsafe) return failsafe;
    hasRequiredFailsafe = 1;
    const Schema2 = requireSchema();
    failsafe = new Schema2({
      explicit: [
        requireStr(),
        requireSeq(),
        requireMap()
      ]
    });
    return failsafe;
  }
  var _null;
  var hasRequired_null;
  function require_null() {
    if (hasRequired_null) return _null;
    hasRequired_null = 1;
    const Type2 = requireType();
    function resolveYamlNull(data) {
      if (data === null) return true;
      const max = data.length;
      return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
    }
    function constructYamlNull() {
      return null;
    }
    function isNull(object) {
      return object === null;
    }
    _null = new Type2("tag:yaml.org,2002:null", {
      kind: "scalar",
      resolve: resolveYamlNull,
      construct: constructYamlNull,
      predicate: isNull,
      represent: {
        canonical: function() {
          return "~";
        },
        lowercase: function() {
          return "null";
        },
        uppercase: function() {
          return "NULL";
        },
        camelcase: function() {
          return "Null";
        },
        empty: function() {
          return "";
        }
      },
      defaultStyle: "lowercase"
    });
    return _null;
  }
  var bool;
  var hasRequiredBool;
  function requireBool() {
    if (hasRequiredBool) return bool;
    hasRequiredBool = 1;
    const Type2 = requireType();
    function resolveYamlBoolean(data) {
      if (data === null) return false;
      const max = data.length;
      return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
    }
    function constructYamlBoolean(data) {
      return data === "true" || data === "True" || data === "TRUE";
    }
    function isBoolean(object) {
      return Object.prototype.toString.call(object) === "[object Boolean]";
    }
    bool = new Type2("tag:yaml.org,2002:bool", {
      kind: "scalar",
      resolve: resolveYamlBoolean,
      construct: constructYamlBoolean,
      predicate: isBoolean,
      represent: {
        lowercase: function(object) {
          return object ? "true" : "false";
        },
        uppercase: function(object) {
          return object ? "TRUE" : "FALSE";
        },
        camelcase: function(object) {
          return object ? "True" : "False";
        }
      },
      defaultStyle: "lowercase"
    });
    return bool;
  }
  var int;
  var hasRequiredInt;
  function requireInt() {
    if (hasRequiredInt) return int;
    hasRequiredInt = 1;
    const common2 = requireCommon();
    const Type2 = requireType();
    function isHexCode(c) {
      return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
    }
    function isOctCode(c) {
      return c >= 48 && c <= 55;
    }
    function isDecCode(c) {
      return c >= 48 && c <= 57;
    }
    function resolveYamlInteger(data) {
      if (data === null) return false;
      const max = data.length;
      let index = 0;
      let hasDigits = false;
      if (!max) return false;
      let ch = data[index];
      if (ch === "-" || ch === "+") {
        ch = data[++index];
      }
      if (ch === "0") {
        if (index + 1 === max) return true;
        ch = data[++index];
        if (ch === "b") {
          index++;
          for (; index < max; index++) {
            ch = data[index];
            if (ch !== "0" && ch !== "1") return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
        if (ch === "x") {
          index++;
          for (; index < max; index++) {
            if (!isHexCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
        if (ch === "o") {
          index++;
          for (; index < max; index++) {
            if (!isOctCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
      }
      for (; index < max; index++) {
        if (!isDecCode(data.charCodeAt(index))) {
          return false;
        }
        hasDigits = true;
      }
      if (!hasDigits) return false;
      return isFinite(parseYamlInteger(data));
    }
    function parseYamlInteger(data) {
      let value = data;
      let sign = 1;
      let ch = value[0];
      if (ch === "-" || ch === "+") {
        if (ch === "-") sign = -1;
        value = value.slice(1);
        ch = value[0];
      }
      if (value === "0") return 0;
      if (ch === "0") {
        if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
        if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
        if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
      }
      return sign * parseInt(value, 10);
    }
    function constructYamlInteger(data) {
      return parseYamlInteger(data);
    }
    function isInteger(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common2.isNegativeZero(object));
    }
    int = new Type2("tag:yaml.org,2002:int", {
      kind: "scalar",
      resolve: resolveYamlInteger,
      construct: constructYamlInteger,
      predicate: isInteger,
      represent: {
        binary: function(obj) {
          return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
        },
        octal: function(obj) {
          return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
        },
        decimal: function(obj) {
          return obj.toString(10);
        },
        hexadecimal: function(obj) {
          return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
        }
      },
      defaultStyle: "decimal",
      styleAliases: {
        binary: [2, "bin"],
        octal: [8, "oct"],
        decimal: [10, "dec"],
        hexadecimal: [16, "hex"]
      }
    });
    return int;
  }
  var float;
  var hasRequiredFloat;
  function requireFloat() {
    if (hasRequiredFloat) return float;
    hasRequiredFloat = 1;
    const common2 = requireCommon();
    const Type2 = requireType();
    const YAML_FLOAT_PATTERN = new RegExp(
      // 2.5e4, 2.5 and integers
      "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    const YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
      "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    function resolveYamlFloat(data) {
      if (data === null) return false;
      if (!YAML_FLOAT_PATTERN.test(data)) {
        return false;
      }
      if (isFinite(parseFloat(data, 10))) {
        return true;
      }
      return YAML_FLOAT_SPECIAL_PATTERN.test(data);
    }
    function constructYamlFloat(data) {
      let value = data.toLowerCase();
      const sign = value[0] === "-" ? -1 : 1;
      if ("+-".indexOf(value[0]) >= 0) {
        value = value.slice(1);
      }
      if (value === ".inf") {
        return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      } else if (value === ".nan") {
        return NaN;
      }
      return sign * parseFloat(value, 10);
    }
    const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
    function representYamlFloat(object, style) {
      if (isNaN(object)) {
        switch (style) {
          case "lowercase":
            return ".nan";
          case "uppercase":
            return ".NAN";
          case "camelcase":
            return ".NaN";
        }
      } else if (Number.POSITIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return ".inf";
          case "uppercase":
            return ".INF";
          case "camelcase":
            return ".Inf";
        }
      } else if (Number.NEGATIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return "-.inf";
          case "uppercase":
            return "-.INF";
          case "camelcase":
            return "-.Inf";
        }
      } else if (common2.isNegativeZero(object)) {
        return "-0.0";
      }
      const res = object.toString(10);
      return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
    }
    function isFloat(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
    }
    float = new Type2("tag:yaml.org,2002:float", {
      kind: "scalar",
      resolve: resolveYamlFloat,
      construct: constructYamlFloat,
      predicate: isFloat,
      represent: representYamlFloat,
      defaultStyle: "lowercase"
    });
    return float;
  }
  var json;
  var hasRequiredJson;
  function requireJson() {
    if (hasRequiredJson) return json;
    hasRequiredJson = 1;
    json = requireFailsafe().extend({
      implicit: [
        require_null(),
        requireBool(),
        requireInt(),
        requireFloat()
      ]
    });
    return json;
  }
  var core;
  var hasRequiredCore;
  function requireCore() {
    if (hasRequiredCore) return core;
    hasRequiredCore = 1;
    core = requireJson();
    return core;
  }
  var timestamp;
  var hasRequiredTimestamp;
  function requireTimestamp() {
    if (hasRequiredTimestamp) return timestamp;
    hasRequiredTimestamp = 1;
    const Type2 = requireType();
    const YAML_DATE_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
    );
    const YAML_TIMESTAMP_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
    );
    function resolveYamlTimestamp(data) {
      if (data === null) return false;
      if (YAML_DATE_REGEXP.exec(data) !== null) return true;
      if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
      return false;
    }
    function constructYamlTimestamp(data) {
      let fraction = 0;
      let delta = null;
      let match = YAML_DATE_REGEXP.exec(data);
      if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
      if (match === null) throw new Error("Date resolve error");
      const year = +match[1];
      const month = +match[2] - 1;
      const day = +match[3];
      if (!match[4]) {
        return new Date(Date.UTC(year, month, day));
      }
      const hour = +match[4];
      const minute = +match[5];
      const second = +match[6];
      if (match[7]) {
        fraction = match[7].slice(0, 3);
        while (fraction.length < 3) {
          fraction += "0";
        }
        fraction = +fraction;
      }
      if (match[9]) {
        const tzHour = +match[10];
        const tzMinute = +(match[11] || 0);
        delta = (tzHour * 60 + tzMinute) * 6e4;
        if (match[9] === "-") delta = -delta;
      }
      const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
      if (delta) date.setTime(date.getTime() - delta);
      return date;
    }
    function representYamlTimestamp(object) {
      return object.toISOString();
    }
    timestamp = new Type2("tag:yaml.org,2002:timestamp", {
      kind: "scalar",
      resolve: resolveYamlTimestamp,
      construct: constructYamlTimestamp,
      instanceOf: Date,
      represent: representYamlTimestamp
    });
    return timestamp;
  }
  var merge;
  var hasRequiredMerge;
  function requireMerge() {
    if (hasRequiredMerge) return merge;
    hasRequiredMerge = 1;
    const Type2 = requireType();
    function resolveYamlMerge(data) {
      return data === "<<" || data === null;
    }
    merge = new Type2("tag:yaml.org,2002:merge", {
      kind: "scalar",
      resolve: resolveYamlMerge
    });
    return merge;
  }
  var binary;
  var hasRequiredBinary;
  function requireBinary() {
    if (hasRequiredBinary) return binary;
    hasRequiredBinary = 1;
    const Type2 = requireType();
    const BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
    function resolveYamlBinary(data) {
      if (data === null) return false;
      let bitlen = 0;
      const max = data.length;
      const map2 = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        const code = map2.indexOf(data.charAt(idx));
        if (code > 64) continue;
        if (code < 0) return false;
        bitlen += 6;
      }
      return bitlen % 8 === 0;
    }
    function constructYamlBinary(data) {
      const input = data.replace(/[\r\n=]/g, "");
      const max = input.length;
      const map2 = BASE64_MAP;
      let bits = 0;
      const result = [];
      for (let idx = 0; idx < max; idx++) {
        if (idx % 4 === 0 && idx) {
          result.push(bits >> 16 & 255);
          result.push(bits >> 8 & 255);
          result.push(bits & 255);
        }
        bits = bits << 6 | map2.indexOf(input.charAt(idx));
      }
      const tailbits = max % 4 * 6;
      if (tailbits === 0) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      } else if (tailbits === 18) {
        result.push(bits >> 10 & 255);
        result.push(bits >> 2 & 255);
      } else if (tailbits === 12) {
        result.push(bits >> 4 & 255);
      }
      return new Uint8Array(result);
    }
    function representYamlBinary(object) {
      let result = "";
      let bits = 0;
      const max = object.length;
      const map2 = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result += map2[bits >> 18 & 63];
          result += map2[bits >> 12 & 63];
          result += map2[bits >> 6 & 63];
          result += map2[bits & 63];
        }
        bits = (bits << 8) + object[idx];
      }
      const tail = max % 3;
      if (tail === 0) {
        result += map2[bits >> 18 & 63];
        result += map2[bits >> 12 & 63];
        result += map2[bits >> 6 & 63];
        result += map2[bits & 63];
      } else if (tail === 2) {
        result += map2[bits >> 10 & 63];
        result += map2[bits >> 4 & 63];
        result += map2[bits << 2 & 63];
        result += map2[64];
      } else if (tail === 1) {
        result += map2[bits >> 2 & 63];
        result += map2[bits << 4 & 63];
        result += map2[64];
        result += map2[64];
      }
      return result;
    }
    function isBinary(obj) {
      return Object.prototype.toString.call(obj) === "[object Uint8Array]";
    }
    binary = new Type2("tag:yaml.org,2002:binary", {
      kind: "scalar",
      resolve: resolveYamlBinary,
      construct: constructYamlBinary,
      predicate: isBinary,
      represent: representYamlBinary
    });
    return binary;
  }
  var omap;
  var hasRequiredOmap;
  function requireOmap() {
    if (hasRequiredOmap) return omap;
    hasRequiredOmap = 1;
    const Type2 = requireType();
    const _hasOwnProperty = Object.prototype.hasOwnProperty;
    const _toString = Object.prototype.toString;
    function resolveYamlOmap(data) {
      if (data === null) return true;
      const objectKeys = {};
      const object = data;
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        let pairHasKey = false;
        if (_toString.call(pair) !== "[object Object]") return false;
        let pairKey;
        for (pairKey in pair) {
          if (_hasOwnProperty.call(pair, pairKey)) {
            if (!pairHasKey) pairHasKey = true;
            else return false;
          }
        }
        if (!pairHasKey) return false;
        if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
        Object.defineProperty(objectKeys, pairKey, { value: true });
      }
      return true;
    }
    function constructYamlOmap(data) {
      return data !== null ? data : [];
    }
    omap = new Type2("tag:yaml.org,2002:omap", {
      kind: "sequence",
      resolve: resolveYamlOmap,
      construct: constructYamlOmap
    });
    return omap;
  }
  var pairs;
  var hasRequiredPairs;
  function requirePairs() {
    if (hasRequiredPairs) return pairs;
    hasRequiredPairs = 1;
    const Type2 = requireType();
    const _toString = Object.prototype.toString;
    function resolveYamlPairs(data) {
      if (data === null) return true;
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        const keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        const keys = Object.keys(pair);
        result[index] = [keys[0], pair[keys[0]]];
      }
      return result;
    }
    pairs = new Type2("tag:yaml.org,2002:pairs", {
      kind: "sequence",
      resolve: resolveYamlPairs,
      construct: constructYamlPairs
    });
    return pairs;
  }
  var set;
  var hasRequiredSet;
  function requireSet() {
    if (hasRequiredSet) return set;
    hasRequiredSet = 1;
    const Type2 = requireType();
    const _hasOwnProperty = Object.prototype.hasOwnProperty;
    function resolveYamlSet(data) {
      if (data === null) return true;
      const object = data;
      for (const key in object) {
        if (_hasOwnProperty.call(object, key)) {
          if (object[key] !== null) return false;
        }
      }
      return true;
    }
    function constructYamlSet(data) {
      return data !== null ? data : {};
    }
    set = new Type2("tag:yaml.org,2002:set", {
      kind: "mapping",
      resolve: resolveYamlSet,
      construct: constructYamlSet
    });
    return set;
  }
  var _default;
  var hasRequired_default;
  function require_default() {
    if (hasRequired_default) return _default;
    hasRequired_default = 1;
    _default = requireCore().extend({
      implicit: [
        requireTimestamp(),
        requireMerge()
      ],
      explicit: [
        requireBinary(),
        requireOmap(),
        requirePairs(),
        requireSet()
      ]
    });
    return _default;
  }
  var hasRequiredLoader;
  function requireLoader() {
    if (hasRequiredLoader) return loader;
    hasRequiredLoader = 1;
    const common2 = requireCommon();
    const YAMLException2 = requireException();
    const makeSnippet = requireSnippet();
    const DEFAULT_SCHEMA2 = require_default();
    const _hasOwnProperty = Object.prototype.hasOwnProperty;
    const CONTEXT_FLOW_IN = 1;
    const CONTEXT_FLOW_OUT = 2;
    const CONTEXT_BLOCK_IN = 3;
    const CONTEXT_BLOCK_OUT = 4;
    const CHOMPING_CLIP = 1;
    const CHOMPING_STRIP = 2;
    const CHOMPING_KEEP = 3;
    const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
    const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
    const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
    const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function isEol(c) {
      return c === 10 || c === 13;
    }
    function isWhiteSpace(c) {
      return c === 9 || c === 32;
    }
    function isWsOrEol(c) {
      return c === 9 || c === 32 || c === 10 || c === 13;
    }
    function isFlowIndicator(c) {
      return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
    }
    function fromHexCode(c) {
      if (c >= 48 && c <= 57) {
        return c - 48;
      }
      const lc = c | 32;
      if (lc >= 97 && lc <= 102) {
        return lc - 97 + 10;
      }
      return -1;
    }
    function escapedHexLen(c) {
      if (c === 120) {
        return 2;
      }
      if (c === 117) {
        return 4;
      }
      if (c === 85) {
        return 8;
      }
      return 0;
    }
    function fromDecimalCode(c) {
      if (c >= 48 && c <= 57) {
        return c - 48;
      }
      return -1;
    }
    function simpleEscapeSequence(c) {
      switch (c) {
        case 48:
          return "\0";
        case 97:
          return "\x07";
        case 98:
          return "\b";
        case 116:
          return "	";
        case 9:
          return "	";
        case 110:
          return "\n";
        case 118:
          return "\v";
        case 102:
          return "\f";
        case 114:
          return "\r";
        case 101:
          return "\x1B";
        case 32:
          return " ";
        case 34:
          return '"';
        case 47:
          return "/";
        case 92:
          return "\\";
        case 78:
          return "\x85";
        case 95:
          return "\xA0";
        case 76:
          return "\u2028";
        case 80:
          return "\u2029";
        default:
          return "";
      }
    }
    function charFromCodepoint(c) {
      if (c <= 65535) {
        return String.fromCharCode(c);
      }
      return String.fromCharCode(
        (c - 65536 >> 10) + 55296,
        (c - 65536 & 1023) + 56320
      );
    }
    function setProperty(object, key, value) {
      if (key === "__proto__") {
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
      } else {
        object[key] = value;
      }
    }
    const simpleEscapeCheck = new Array(256);
    const simpleEscapeMap = new Array(256);
    for (let i = 0; i < 256; i++) {
      simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
      simpleEscapeMap[i] = simpleEscapeSequence(i);
    }
    function State(input, options) {
      this.input = input;
      this.filename = options["filename"] || null;
      this.schema = options["schema"] || DEFAULT_SCHEMA2;
      this.onWarning = options["onWarning"] || null;
      this.legacy = options["legacy"] || false;
      this.json = options["json"] || false;
      this.listener = options["listener"] || null;
      this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
      this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
      this.implicitTypes = this.schema.compiledImplicit;
      this.typeMap = this.schema.compiledTypeMap;
      this.length = input.length;
      this.position = 0;
      this.line = 0;
      this.lineStart = 0;
      this.lineIndent = 0;
      this.depth = 0;
      this.totalMergeKeys = 0;
      this.firstTabInLine = -1;
      this.documents = [];
      this.anchorMapTransactions = [];
    }
    function generateError(state, message) {
      const mark = {
        name: state.filename,
        buffer: state.input.slice(0, -1),
        // omit trailing \0
        position: state.position,
        line: state.line,
        column: state.position - state.lineStart
      };
      mark.snippet = makeSnippet(mark);
      return new YAMLException2(message, mark);
    }
    function throwError(state, message) {
      throw generateError(state, message);
    }
    function throwWarning(state, message) {
      if (state.onWarning) {
        state.onWarning.call(null, generateError(state, message));
      }
    }
    function storeAnchor(state, name, value) {
      const transactions = state.anchorMapTransactions;
      if (transactions.length !== 0) {
        const transaction = transactions[transactions.length - 1];
        if (!_hasOwnProperty.call(transaction, name)) {
          transaction[name] = {
            existed: _hasOwnProperty.call(state.anchorMap, name),
            value: state.anchorMap[name]
          };
        }
      }
      state.anchorMap[name] = value;
    }
    function beginAnchorTransaction(state) {
      state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
    }
    function commitAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const transactions = state.anchorMapTransactions;
      if (transactions.length === 0) return;
      const parent = transactions[transactions.length - 1];
      const names = Object.keys(transaction);
      for (let index = 0, length = names.length; index < length; index += 1) {
        const name = names[index];
        if (!_hasOwnProperty.call(parent, name)) {
          parent[name] = transaction[name];
        }
      }
    }
    function rollbackAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const names = Object.keys(transaction);
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const entry = transaction[names[index]];
        if (entry.existed) {
          state.anchorMap[names[index]] = entry.value;
        } else {
          delete state.anchorMap[names[index]];
        }
      }
    }
    function snapshotState(state) {
      return {
        position: state.position,
        line: state.line,
        lineStart: state.lineStart,
        lineIndent: state.lineIndent,
        firstTabInLine: state.firstTabInLine,
        tag: state.tag,
        anchor: state.anchor,
        kind: state.kind,
        result: state.result
      };
    }
    function restoreState(state, snapshot) {
      state.position = snapshot.position;
      state.line = snapshot.line;
      state.lineStart = snapshot.lineStart;
      state.lineIndent = snapshot.lineIndent;
      state.firstTabInLine = snapshot.firstTabInLine;
      state.tag = snapshot.tag;
      state.anchor = snapshot.anchor;
      state.kind = snapshot.kind;
      state.result = snapshot.result;
    }
    const directiveHandlers = {
      YAML: function handleYamlDirective(state, name, args) {
        if (state.version !== null) {
          throwError(state, "duplication of %YAML directive");
        }
        if (args.length !== 1) {
          throwError(state, "YAML directive accepts exactly one argument");
        }
        const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
        if (match === null) {
          throwError(state, "ill-formed argument of the YAML directive");
        }
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major !== 1) {
          throwError(state, "unacceptable YAML version of the document");
        }
        state.version = args[0];
        state.checkLineBreaks = minor < 2;
        if (minor !== 1 && minor !== 2) {
          throwWarning(state, "unsupported YAML version of the document");
        }
      },
      TAG: function handleTagDirective(state, name, args) {
        let prefix;
        if (args.length !== 2) {
          throwError(state, "TAG directive accepts exactly two arguments");
        }
        const handle = args[0];
        prefix = args[1];
        if (!PATTERN_TAG_HANDLE.test(handle)) {
          throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
        }
        if (_hasOwnProperty.call(state.tagMap, handle)) {
          throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
        }
        if (!PATTERN_TAG_URI.test(prefix)) {
          throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
        }
        try {
          prefix = decodeURIComponent(prefix);
        } catch (err) {
          throwError(state, "tag prefix is malformed: " + prefix);
        }
        state.tagMap[handle] = prefix;
      }
    };
    function captureSegment(state, start, end, checkJson) {
      if (start < end) {
        const _result = state.input.slice(start, end);
        if (checkJson) {
          for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
            const _character = _result.charCodeAt(_position);
            if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
              throwError(state, "expected valid JSON character");
            }
          }
        } else if (PATTERN_NON_PRINTABLE.test(_result)) {
          throwError(state, "the stream contains non-printable characters");
        }
        state.result += _result;
      }
    }
    function mergeMappings(state, destination, source2, overridableKeys) {
      if (!common2.isObject(source2)) {
        throwError(state, "cannot merge mappings; the provided source object is unacceptable");
      }
      const sourceKeys = Object.keys(source2);
      for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
        const key = sourceKeys[index];
        if (state.maxTotalMergeKeys !== -1 && ++state.totalMergeKeys > state.maxTotalMergeKeys) {
          throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
        }
        if (!_hasOwnProperty.call(destination, key)) {
          setProperty(destination, key, source2[key]);
          overridableKeys[key] = true;
        }
      }
    }
    function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
      if (Array.isArray(keyNode)) {
        keyNode = Array.prototype.slice.call(keyNode);
        for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
          if (Array.isArray(keyNode[index])) {
            throwError(state, "nested arrays are not supported inside keys");
          }
          if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
            keyNode[index] = "[object Object]";
          }
        }
      }
      if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
        keyNode = "[object Object]";
      }
      keyNode = String(keyNode);
      if (_result === null) {
        _result = {};
      }
      if (keyTag === "tag:yaml.org,2002:merge") {
        if (Array.isArray(valueNode)) {
          for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
            mergeMappings(state, _result, valueNode[index], overridableKeys);
          }
        } else {
          mergeMappings(state, _result, valueNode, overridableKeys);
        }
      } else {
        if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
          state.line = startLine || state.line;
          state.lineStart = startLineStart || state.lineStart;
          state.position = startPos || state.position;
          throwError(state, "duplicated mapping key");
        }
        setProperty(_result, keyNode, valueNode);
        delete overridableKeys[keyNode];
      }
      return _result;
    }
    function readLineBreak(state) {
      const ch = state.input.charCodeAt(state.position);
      if (ch === 10) {
        state.position++;
      } else if (ch === 13) {
        state.position++;
        if (state.input.charCodeAt(state.position) === 10) {
          state.position++;
        }
      } else {
        throwError(state, "a line break is expected");
      }
      state.line += 1;
      state.lineStart = state.position;
      state.firstTabInLine = -1;
    }
    function skipSeparationSpace(state, allowComments, checkIndent) {
      let lineBreaks = 0;
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          if (ch === 9 && state.firstTabInLine === -1) {
            state.firstTabInLine = state.position;
          }
          ch = state.input.charCodeAt(++state.position);
        }
        if (allowComments && ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 10 && ch !== 13 && ch !== 0);
        }
        if (isEol(ch)) {
          readLineBreak(state);
          ch = state.input.charCodeAt(state.position);
          lineBreaks++;
          state.lineIndent = 0;
          while (ch === 32) {
            state.lineIndent++;
            ch = state.input.charCodeAt(++state.position);
          }
        } else {
          break;
        }
      }
      if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
        throwWarning(state, "deficient indentation");
      }
      return lineBreaks;
    }
    function testDocumentSeparator(state) {
      let _position = state.position;
      let ch = state.input.charCodeAt(_position);
      if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
        _position += 3;
        ch = state.input.charCodeAt(_position);
        if (ch === 0 || isWsOrEol(ch)) {
          return true;
        }
      }
      return false;
    }
    function writeFoldedLines(state, count) {
      if (count === 1) {
        state.result += " ";
      } else if (count > 1) {
        state.result += common2.repeat("\n", count - 1);
      }
    }
    function readPlainScalar(state, nodeIndent, withinFlowCollection) {
      let captureStart;
      let captureEnd;
      let hasPendingContent;
      let _line;
      let _lineStart;
      let _lineIndent;
      const _kind = state.kind;
      const _result = state.result;
      let ch = state.input.charCodeAt(state.position);
      if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
        return false;
      }
      if (ch === 63 || ch === 45) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          return false;
        }
      }
      state.kind = "scalar";
      state.result = "";
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
      while (ch !== 0) {
        if (ch === 58) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
            break;
          }
        } else if (ch === 35) {
          const preceding = state.input.charCodeAt(state.position - 1);
          if (isWsOrEol(preceding)) {
            break;
          }
        } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
          break;
        } else if (isEol(ch)) {
          _line = state.line;
          _lineStart = state.lineStart;
          _lineIndent = state.lineIndent;
          skipSeparationSpace(state, false, -1);
          if (state.lineIndent >= nodeIndent) {
            hasPendingContent = true;
            ch = state.input.charCodeAt(state.position);
            continue;
          } else {
            state.position = captureEnd;
            state.line = _line;
            state.lineStart = _lineStart;
            state.lineIndent = _lineIndent;
            break;
          }
        }
        if (hasPendingContent) {
          captureSegment(state, captureStart, captureEnd, false);
          writeFoldedLines(state, state.line - _line);
          captureStart = captureEnd = state.position;
          hasPendingContent = false;
        }
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position + 1;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, captureEnd, false);
      if (state.result) {
        return true;
      }
      state.kind = _kind;
      state.result = _result;
      return false;
    }
    function readSingleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 39) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 39) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (ch === 39) {
            captureStart = state.position;
            state.position++;
            captureEnd = state.position;
          } else {
            return true;
          }
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a single quoted scalar");
        } else {
          state.position++;
          if (!isWhiteSpace(ch)) {
            captureEnd = state.position;
          }
        }
      }
      throwError(state, "unexpected end of the stream within a single quoted scalar");
    }
    function readDoubleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 34) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 34) {
          captureSegment(state, captureStart, state.position, true);
          state.position++;
          return true;
        } else if (ch === 92) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (isEol(ch)) {
            skipSeparationSpace(state, false, nodeIndent);
          } else if (ch < 256 && simpleEscapeCheck[ch]) {
            state.result += simpleEscapeMap[ch];
            state.position++;
          } else if ((tmp = escapedHexLen(ch)) > 0) {
            let hexLength = tmp;
            let hexResult = 0;
            for (; hexLength > 0; hexLength--) {
              ch = state.input.charCodeAt(++state.position);
              if ((tmp = fromHexCode(ch)) >= 0) {
                hexResult = (hexResult << 4) + tmp;
              } else {
                throwError(state, "expected hexadecimal character");
              }
            }
            state.result += charFromCodepoint(hexResult);
            state.position++;
          } else {
            throwError(state, "unknown escape sequence");
          }
          captureStart = captureEnd = state.position;
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a double quoted scalar");
        } else {
          state.position++;
          if (!isWhiteSpace(ch)) {
            captureEnd = state.position;
          }
        }
      }
      throwError(state, "unexpected end of the stream within a double quoted scalar");
    }
    function readFlowCollection(state, nodeIndent) {
      let readNext = true;
      let _line;
      let _lineStart;
      let _pos;
      const _tag = state.tag;
      let _result;
      const _anchor = state.anchor;
      let terminator;
      let isPair;
      let isExplicitPair;
      let isMapping;
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyNode;
      let keyTag;
      let valueNode;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 91) {
        terminator = 93;
        isMapping = false;
        _result = [];
      } else if (ch === 123) {
        terminator = 125;
        isMapping = true;
        _result = {};
      } else {
        return false;
      }
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      ch = state.input.charCodeAt(++state.position);
      while (ch !== 0) {
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === terminator) {
          state.position++;
          state.tag = _tag;
          state.anchor = _anchor;
          state.kind = isMapping ? "mapping" : "sequence";
          state.result = _result;
          return true;
        } else if (!readNext) {
          throwError(state, "missed comma between flow collection entries");
        } else if (ch === 44) {
          throwError(state, "expected the node content, but found ','");
        }
        keyTag = keyNode = valueNode = null;
        isPair = isExplicitPair = false;
        if (ch === 63) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following)) {
            isPair = isExplicitPair = true;
            state.position++;
            skipSeparationSpace(state, true, nodeIndent);
          }
        }
        _line = state.line;
        _lineStart = state.lineStart;
        _pos = state.position;
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        keyTag = state.tag;
        keyNode = state.result;
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if ((isExplicitPair || state.line === _line) && ch === 58) {
          isPair = true;
          ch = state.input.charCodeAt(++state.position);
          skipSeparationSpace(state, true, nodeIndent);
          composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
          valueNode = state.result;
        }
        if (isMapping) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
        } else if (isPair) {
          _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
        } else {
          _result.push(keyNode);
        }
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === 44) {
          readNext = true;
          ch = state.input.charCodeAt(++state.position);
        } else {
          readNext = false;
        }
      }
      throwError(state, "unexpected end of the stream within a flow collection");
    }
    function readBlockScalar(state, nodeIndent) {
      let folding;
      let chomping = CHOMPING_CLIP;
      let didReadContent = false;
      let detectedIndent = false;
      let textIndent = nodeIndent;
      let emptyLines = 0;
      let atMoreIndented = false;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 124) {
        folding = false;
      } else if (ch === 62) {
        folding = true;
      } else {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      while (ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
        if (ch === 43 || ch === 45) {
          if (CHOMPING_CLIP === chomping) {
            chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
          } else {
            throwError(state, "repeat of a chomping mode identifier");
          }
        } else if ((tmp = fromDecimalCode(ch)) >= 0) {
          if (tmp === 0) {
            throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
          } else if (!detectedIndent) {
            textIndent = nodeIndent + tmp - 1;
            detectedIndent = true;
          } else {
            throwError(state, "repeat of an indentation width identifier");
          }
        } else {
          break;
        }
      }
      if (isWhiteSpace(ch)) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (isWhiteSpace(ch));
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (!isEol(ch) && ch !== 0);
        }
      }
      while (ch !== 0) {
        readLineBreak(state);
        state.lineIndent = 0;
        ch = state.input.charCodeAt(state.position);
        while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
        if (!detectedIndent && state.lineIndent > textIndent) {
          textIndent = state.lineIndent;
        }
        if (isEol(ch)) {
          emptyLines++;
          continue;
        }
        if (!detectedIndent && textIndent === 0) {
          throwError(state, "missing indentation for block scalar");
        }
        if (state.lineIndent < textIndent) {
          if (chomping === CHOMPING_KEEP) {
            state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (chomping === CHOMPING_CLIP) {
            if (didReadContent) {
              state.result += "\n";
            }
          }
          break;
        }
        if (folding) {
          if (isWhiteSpace(ch)) {
            atMoreIndented = true;
            state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (atMoreIndented) {
            atMoreIndented = false;
            state.result += common2.repeat("\n", emptyLines + 1);
          } else if (emptyLines === 0) {
            if (didReadContent) {
              state.result += " ";
            }
          } else {
            state.result += common2.repeat("\n", emptyLines);
          }
        } else {
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        }
        didReadContent = true;
        detectedIndent = true;
        emptyLines = 0;
        const captureStart = state.position;
        while (!isEol(ch) && ch !== 0) {
          ch = state.input.charCodeAt(++state.position);
        }
        captureSegment(state, captureStart, state.position, false);
      }
      return true;
    }
    function readBlockSequence(state, nodeIndent) {
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = [];
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        if (ch !== 45) {
          break;
        }
        const following = state.input.charCodeAt(state.position + 1);
        if (!isWsOrEol(following)) {
          break;
        }
        detected = true;
        state.position++;
        if (skipSeparationSpace(state, true, -1)) {
          if (state.lineIndent <= nodeIndent) {
            _result.push(null);
            ch = state.input.charCodeAt(state.position);
            continue;
          }
        }
        const _line = state.line;
        composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
        _result.push(state.result);
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
          throwError(state, "bad indentation of a sequence entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "sequence";
        state.result = _result;
        return true;
      }
      return false;
    }
    function readBlockMapping(state, nodeIndent, flowIndent) {
      let allowCompact;
      let _keyLine;
      let _keyLineStart;
      let _keyPos;
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = {};
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyTag = null;
      let keyNode = null;
      let valueNode = null;
      let atExplicitKey = false;
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (!atExplicitKey && state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        const following = state.input.charCodeAt(state.position + 1);
        const _line = state.line;
        if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
          if (ch === 63) {
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = true;
            allowCompact = true;
          } else if (atExplicitKey) {
            atExplicitKey = false;
            allowCompact = true;
          } else {
            throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
          }
          state.position += 1;
          ch = following;
        } else {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
          if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
            break;
          }
          if (state.line === _line) {
            ch = state.input.charCodeAt(state.position);
            while (isWhiteSpace(ch)) {
              ch = state.input.charCodeAt(++state.position);
            }
            if (ch === 58) {
              ch = state.input.charCodeAt(++state.position);
              if (!isWsOrEol(ch)) {
                throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
              }
              if (atExplicitKey) {
                storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
                keyTag = keyNode = valueNode = null;
              }
              detected = true;
              atExplicitKey = false;
              allowCompact = false;
              keyTag = state.tag;
              keyNode = state.result;
            } else if (detected) {
              throwError(state, "can not read an implicit mapping pair; a colon is missed");
            } else {
              state.tag = _tag;
              state.anchor = _anchor;
              return true;
            }
          } else if (detected) {
            throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        }
        if (state.line === _line || state.lineIndent > nodeIndent) {
          if (atExplicitKey) {
            _keyLine = state.line;
            _keyLineStart = state.lineStart;
            _keyPos = state.position;
          }
          if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
            if (atExplicitKey) {
              keyNode = state.result;
            } else {
              valueNode = state.result;
            }
          }
          if (!atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
        }
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
          throwError(state, "bad indentation of a mapping entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "mapping";
        state.result = _result;
      }
      return detected;
    }
    function readTagProperty(state) {
      let isVerbatim = false;
      let isNamed = false;
      let tagHandle;
      let tagName;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 33) return false;
      if (state.tag !== null) {
        throwError(state, "duplication of a tag property");
      }
      ch = state.input.charCodeAt(++state.position);
      if (ch === 60) {
        isVerbatim = true;
        ch = state.input.charCodeAt(++state.position);
      } else if (ch === 33) {
        isNamed = true;
        tagHandle = "!!";
        ch = state.input.charCodeAt(++state.position);
      } else {
        tagHandle = "!";
      }
      let _position = state.position;
      if (isVerbatim) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && ch !== 62);
        if (state.position < state.length) {
          tagName = state.input.slice(_position, state.position);
          ch = state.input.charCodeAt(++state.position);
        } else {
          throwError(state, "unexpected end of the stream within a verbatim tag");
        }
      } else {
        while (ch !== 0 && !isWsOrEol(ch)) {
          if (ch === 33) {
            if (!isNamed) {
              tagHandle = state.input.slice(_position - 1, state.position + 1);
              if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
                throwError(state, "named tag handle cannot contain such characters");
              }
              isNamed = true;
              _position = state.position + 1;
            } else {
              throwError(state, "tag suffix cannot contain exclamation marks");
            }
          }
          ch = state.input.charCodeAt(++state.position);
        }
        tagName = state.input.slice(_position, state.position);
        if (PATTERN_FLOW_INDICATORS.test(tagName)) {
          throwError(state, "tag suffix cannot contain flow indicator characters");
        }
      }
      if (tagName && !PATTERN_TAG_URI.test(tagName)) {
        throwError(state, "tag name cannot contain such characters: " + tagName);
      }
      try {
        tagName = decodeURIComponent(tagName);
      } catch (err) {
        throwError(state, "tag name is malformed: " + tagName);
      }
      if (isVerbatim) {
        state.tag = tagName;
      } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
        state.tag = state.tagMap[tagHandle] + tagName;
      } else if (tagHandle === "!") {
        state.tag = "!" + tagName;
      } else if (tagHandle === "!!") {
        state.tag = "tag:yaml.org,2002:" + tagName;
      } else {
        throwError(state, 'undeclared tag handle "' + tagHandle + '"');
      }
      return true;
    }
    function readAnchorProperty(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 38) return false;
      if (state.anchor !== null) {
        throwError(state, "duplication of an anchor property");
      }
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an anchor node must contain at least one character");
      }
      state.anchor = state.input.slice(_position, state.position);
      return true;
    }
    function readAlias(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 42) return false;
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an alias node must contain at least one character");
      }
      const alias = state.input.slice(_position, state.position);
      if (!_hasOwnProperty.call(state.anchorMap, alias)) {
        throwError(state, 'unidentified alias "' + alias + '"');
      }
      state.result = state.anchorMap[alias];
      skipSeparationSpace(state, true, -1);
      return true;
    }
    function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
      const fallbackState = snapshotState(state);
      beginAnchorTransaction(state);
      restoreState(state, propertyStart);
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
        commitAnchorTransaction(state);
        return true;
      }
      rollbackAnchorTransaction(state);
      restoreState(state, fallbackState);
      return false;
    }
    function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
      let allowBlockScalars;
      let allowBlockCollections;
      let indentStatus = 1;
      let atNewLine = false;
      let hasContent = false;
      let propertyStart = null;
      let type2;
      let flowIndent;
      let blockIndent;
      if (state.depth >= state.maxDepth) {
        throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
      }
      state.depth += 1;
      if (state.listener !== null) {
        state.listener("open", state);
      }
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
      if (allowToSeek) {
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        }
      }
      if (indentStatus === 1) {
        while (true) {
          const ch = state.input.charCodeAt(state.position);
          const propertyState = snapshotState(state);
          if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
            break;
          }
          if (!readTagProperty(state) && !readAnchorProperty(state)) {
            break;
          }
          if (propertyStart === null) {
            propertyStart = propertyState;
          }
          if (skipSeparationSpace(state, true, -1)) {
            atNewLine = true;
            allowBlockCollections = allowBlockStyles;
            if (state.lineIndent > parentIndent) {
              indentStatus = 1;
            } else if (state.lineIndent === parentIndent) {
              indentStatus = 0;
            } else if (state.lineIndent < parentIndent) {
              indentStatus = -1;
            }
          } else {
            allowBlockCollections = false;
          }
        }
      }
      if (allowBlockCollections) {
        allowBlockCollections = atNewLine || allowCompact;
      }
      if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
        if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
          flowIndent = parentIndent;
        } else {
          flowIndent = parentIndent + 1;
        }
        blockIndent = state.position - state.lineStart;
        if (indentStatus === 1) {
          if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
            hasContent = true;
          } else {
            const ch = state.input.charCodeAt(state.position);
            if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
              state,
              propertyStart,
              propertyStart.position - propertyStart.lineStart,
              flowIndent
            )) {
              hasContent = true;
            } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
              hasContent = true;
            } else if (readAlias(state)) {
              hasContent = true;
              if (state.tag !== null || state.anchor !== null) {
                throwError(state, "alias node should not have any properties");
              }
            } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
              hasContent = true;
              if (state.tag === null) {
                state.tag = "?";
              }
            }
            if (state.anchor !== null) {
              storeAnchor(state, state.anchor, state.result);
            }
          }
        } else if (indentStatus === 0) {
          hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
        }
      }
      if (state.tag === null) {
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      } else if (state.tag === "?") {
        if (state.result !== null && state.kind !== "scalar") {
          throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
        }
        for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
          type2 = state.implicitTypes[typeIndex];
          if (type2.resolve(state.result)) {
            state.result = type2.construct(state.result);
            state.tag = type2.tag;
            if (state.anchor !== null) {
              storeAnchor(state, state.anchor, state.result);
            }
            break;
          }
        }
      } else if (state.tag !== "!") {
        if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
          type2 = state.typeMap[state.kind || "fallback"][state.tag];
        } else {
          type2 = null;
          const typeList = state.typeMap.multi[state.kind || "fallback"];
          for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
            if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
              type2 = typeList[typeIndex];
              break;
            }
          }
        }
        if (!type2) {
          throwError(state, "unknown tag !<" + state.tag + ">");
        }
        if (state.result !== null && type2.kind !== state.kind) {
          throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
        }
        if (!type2.resolve(state.result, state.tag)) {
          throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
        } else {
          state.result = type2.construct(state.result, state.tag);
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      }
      if (state.listener !== null) {
        state.listener("close", state);
      }
      state.depth -= 1;
      return state.tag !== null || state.anchor !== null || hasContent;
    }
    function readDocument(state) {
      const documentStart = state.position;
      let hasDirectives = false;
      let ch;
      state.version = null;
      state.checkLineBreaks = state.legacy;
      state.tagMap = /* @__PURE__ */ Object.create(null);
      state.anchorMap = /* @__PURE__ */ Object.create(null);
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if (state.lineIndent > 0 || ch !== 37) {
          break;
        }
        hasDirectives = true;
        ch = state.input.charCodeAt(++state.position);
        let _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        const directiveName = state.input.slice(_position, state.position);
        const directiveArgs = [];
        if (directiveName.length < 1) {
          throwError(state, "directive name must not be less than one character in length");
        }
        while (ch !== 0) {
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 35) {
            do {
              ch = state.input.charCodeAt(++state.position);
            } while (ch !== 0 && !isEol(ch));
            break;
          }
          if (isEol(ch)) break;
          _position = state.position;
          while (ch !== 0 && !isWsOrEol(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          directiveArgs.push(state.input.slice(_position, state.position));
        }
        if (ch !== 0) readLineBreak(state);
        if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
          directiveHandlers[directiveName](state, directiveName, directiveArgs);
        } else {
          throwWarning(state, 'unknown document directive "' + directiveName + '"');
        }
      }
      skipSeparationSpace(state, true, -1);
      if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      } else if (hasDirectives) {
        throwError(state, "directives end mark is expected");
      }
      composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
      skipSeparationSpace(state, true, -1);
      if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
        throwWarning(state, "non-ASCII line breaks are interpreted as content");
      }
      state.documents.push(state.result);
      if (state.position === state.lineStart && testDocumentSeparator(state)) {
        if (state.input.charCodeAt(state.position) === 46) {
          state.position += 3;
          skipSeparationSpace(state, true, -1);
        }
        return;
      }
      if (state.position < state.length - 1) {
        throwError(state, "end of the stream or a document separator is expected");
      }
    }
    function loadDocuments(input, options) {
      input = String(input);
      options = options || {};
      if (input.length !== 0) {
        if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
          input += "\n";
        }
        if (input.charCodeAt(0) === 65279) {
          input = input.slice(1);
        }
      }
      const state = new State(input, options);
      const nullpos = input.indexOf("\0");
      if (nullpos !== -1) {
        state.position = nullpos;
        throwError(state, "null byte is not allowed in input");
      }
      state.input += "\0";
      while (state.input.charCodeAt(state.position) === 32) {
        state.lineIndent += 1;
        state.position += 1;
      }
      while (state.position < state.length - 1) {
        readDocument(state);
      }
      return state.documents;
    }
    function loadAll2(input, iterator, options) {
      if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
        options = iterator;
        iterator = null;
      }
      const documents = loadDocuments(input, options);
      if (typeof iterator !== "function") {
        return documents;
      }
      for (let index = 0, length = documents.length; index < length; index += 1) {
        iterator(documents[index]);
      }
    }
    function load2(input, options) {
      const documents = loadDocuments(input, options);
      if (documents.length === 0) {
        return void 0;
      } else if (documents.length === 1) {
        return documents[0];
      }
      throw new YAMLException2("expected a single document in the stream, but found more");
    }
    loader.loadAll = loadAll2;
    loader.load = load2;
    return loader;
  }
  var dumper = {};
  var hasRequiredDumper;
  function requireDumper() {
    if (hasRequiredDumper) return dumper;
    hasRequiredDumper = 1;
    const common2 = requireCommon();
    const YAMLException2 = requireException();
    const DEFAULT_SCHEMA2 = require_default();
    const _toString = Object.prototype.toString;
    const _hasOwnProperty = Object.prototype.hasOwnProperty;
    const CHAR_BOM = 65279;
    const CHAR_TAB = 9;
    const CHAR_LINE_FEED = 10;
    const CHAR_CARRIAGE_RETURN = 13;
    const CHAR_SPACE = 32;
    const CHAR_EXCLAMATION = 33;
    const CHAR_DOUBLE_QUOTE = 34;
    const CHAR_SHARP = 35;
    const CHAR_PERCENT = 37;
    const CHAR_AMPERSAND = 38;
    const CHAR_SINGLE_QUOTE = 39;
    const CHAR_ASTERISK = 42;
    const CHAR_COMMA = 44;
    const CHAR_MINUS = 45;
    const CHAR_COLON = 58;
    const CHAR_EQUALS = 61;
    const CHAR_GREATER_THAN = 62;
    const CHAR_QUESTION = 63;
    const CHAR_COMMERCIAL_AT = 64;
    const CHAR_LEFT_SQUARE_BRACKET = 91;
    const CHAR_RIGHT_SQUARE_BRACKET = 93;
    const CHAR_GRAVE_ACCENT = 96;
    const CHAR_LEFT_CURLY_BRACKET = 123;
    const CHAR_VERTICAL_LINE = 124;
    const CHAR_RIGHT_CURLY_BRACKET = 125;
    const ESCAPE_SEQUENCES = {};
    ESCAPE_SEQUENCES[0] = "\\0";
    ESCAPE_SEQUENCES[7] = "\\a";
    ESCAPE_SEQUENCES[8] = "\\b";
    ESCAPE_SEQUENCES[9] = "\\t";
    ESCAPE_SEQUENCES[10] = "\\n";
    ESCAPE_SEQUENCES[11] = "\\v";
    ESCAPE_SEQUENCES[12] = "\\f";
    ESCAPE_SEQUENCES[13] = "\\r";
    ESCAPE_SEQUENCES[27] = "\\e";
    ESCAPE_SEQUENCES[34] = '\\"';
    ESCAPE_SEQUENCES[92] = "\\\\";
    ESCAPE_SEQUENCES[133] = "\\N";
    ESCAPE_SEQUENCES[160] = "\\_";
    ESCAPE_SEQUENCES[8232] = "\\L";
    ESCAPE_SEQUENCES[8233] = "\\P";
    const DEPRECATED_BOOLEANS_SYNTAX = [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "on",
      "On",
      "ON",
      "n",
      "N",
      "no",
      "No",
      "NO",
      "off",
      "Off",
      "OFF"
    ];
    const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
    function compileStyleMap(schema2, map2) {
      if (map2 === null) return {};
      const result = {};
      const keys = Object.keys(map2);
      for (let index = 0, length = keys.length; index < length; index += 1) {
        let tag = keys[index];
        let style = String(map2[tag]);
        if (tag.slice(0, 2) === "!!") {
          tag = "tag:yaml.org,2002:" + tag.slice(2);
        }
        const type2 = schema2.compiledTypeMap["fallback"][tag];
        if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
          style = type2.styleAliases[style];
        }
        result[tag] = style;
      }
      return result;
    }
    function encodeHex(character) {
      let handle;
      let length;
      const string = character.toString(16).toUpperCase();
      if (character <= 255) {
        handle = "x";
        length = 2;
      } else if (character <= 65535) {
        handle = "u";
        length = 4;
      } else if (character <= 4294967295) {
        handle = "U";
        length = 8;
      } else {
        throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
      }
      return "\\" + handle + common2.repeat("0", length - string.length) + string;
    }
    const QUOTING_TYPE_SINGLE = 1;
    const QUOTING_TYPE_DOUBLE = 2;
    function State(options) {
      this.schema = options["schema"] || DEFAULT_SCHEMA2;
      this.indent = Math.max(1, options["indent"] || 2);
      this.noArrayIndent = options["noArrayIndent"] || false;
      this.skipInvalid = options["skipInvalid"] || false;
      this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
      this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
      this.sortKeys = options["sortKeys"] || false;
      this.lineWidth = options["lineWidth"] || 80;
      this.noRefs = options["noRefs"] || false;
      this.noCompatMode = options["noCompatMode"] || false;
      this.condenseFlow = options["condenseFlow"] || false;
      this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
      this.forceQuotes = options["forceQuotes"] || false;
      this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
      this.implicitTypes = this.schema.compiledImplicit;
      this.explicitTypes = this.schema.compiledExplicit;
      this.tag = null;
      this.result = "";
      this.duplicates = [];
      this.usedDuplicates = null;
    }
    function indentString(string, spaces) {
      const ind = common2.repeat(" ", spaces);
      let position = 0;
      let result = "";
      const length = string.length;
      while (position < length) {
        let line;
        const next = string.indexOf("\n", position);
        if (next === -1) {
          line = string.slice(position);
          position = length;
        } else {
          line = string.slice(position, next + 1);
          position = next + 1;
        }
        if (line.length && line !== "\n") result += ind;
        result += line;
      }
      return result;
    }
    function generateNextLine(state, level) {
      return "\n" + common2.repeat(" ", state.indent * level);
    }
    function testImplicitResolving(state, str2) {
      for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
        const type2 = state.implicitTypes[index];
        if (type2.resolve(str2)) {
          return true;
        }
      }
      return false;
    }
    function isWhitespace(c) {
      return c === CHAR_SPACE || c === CHAR_TAB;
    }
    function isPrintable(c) {
      return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
    }
    function isNsCharOrWhitespace(c) {
      return isPrintable(c) && c !== CHAR_BOM && // - b-char
      c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
    }
    function isPlainSafe(c, prev, inblock) {
      const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
      const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
      return (
        // ns-plain-safe
        (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && // - c-flow-indicator
        c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && // ns-plain-char
        c !== CHAR_SHARP && // false on '#'
        !(prev === CHAR_COLON && !cIsNsChar) || // false on ': '
        isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || // change to true on '[^ ]#'
        prev === CHAR_COLON && cIsNsChar
      );
    }
    function isPlainSafeFirst(c) {
      return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && // - s-white
      // - (c-indicator ::=
      // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
      c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
      c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && // | “%” | “@” | “`”)
      c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
    }
    function isPlainSafeLast(c) {
      return !isWhitespace(c) && c !== CHAR_COLON;
    }
    function codePointAt(string, pos) {
      const first = string.charCodeAt(pos);
      let second;
      if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
        second = string.charCodeAt(pos + 1);
        if (second >= 56320 && second <= 57343) {
          return (first - 55296) * 1024 + second - 56320 + 65536;
        }
      }
      return first;
    }
    function needIndentIndicator(string) {
      const leadingSpaceRe = /^\n* /;
      return leadingSpaceRe.test(string);
    }
    const STYLE_PLAIN = 1;
    const STYLE_SINGLE = 2;
    const STYLE_LITERAL = 3;
    const STYLE_FOLDED = 4;
    const STYLE_DOUBLE = 5;
    function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
      let i;
      let char = 0;
      let prevChar = null;
      let hasLineBreak = false;
      let hasFoldableLine = false;
      const shouldTrackWidth = lineWidth !== -1;
      let previousLineBreak = -1;
      let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
      if (singleLineOnly || forceQuotes) {
        for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
      } else {
        for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (char === CHAR_LINE_FEED) {
            hasLineBreak = true;
            if (shouldTrackWidth) {
              hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
              i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
              previousLineBreak = i;
            }
          } else if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
        hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
      }
      if (!hasLineBreak && !hasFoldableLine) {
        if (plain && !forceQuotes && !testAmbiguousType(string)) {
          return STYLE_PLAIN;
        }
        return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
      }
      if (indentPerLevel > 9 && needIndentIndicator(string)) {
        return STYLE_DOUBLE;
      }
      if (!forceQuotes) {
        return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    function writeScalar(state, string, level, iskey, inblock) {
      state.dump = (function() {
        if (string.length === 0) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
        }
        if (!state.noCompatMode) {
          if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
            return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
          }
        }
        const indent = state.indent * Math.max(1, level);
        const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
        const singleLineOnly = iskey || // No block styles in flow mode.
        state.flowLevel > -1 && level >= state.flowLevel;
        function testAmbiguity(string2) {
          return testImplicitResolving(state, string2);
        }
        switch (chooseScalarStyle(
          string,
          singleLineOnly,
          state.indent,
          lineWidth,
          testAmbiguity,
          state.quotingType,
          state.forceQuotes && !iskey,
          inblock
        )) {
          case STYLE_PLAIN:
            return string;
          case STYLE_SINGLE:
            return "'" + string.replace(/'/g, "''") + "'";
          case STYLE_LITERAL:
            return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
          case STYLE_FOLDED:
            return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
          case STYLE_DOUBLE:
            return '"' + escapeString(string) + '"';
          default:
            throw new YAMLException2("impossible error: invalid scalar style");
        }
      })();
    }
    function blockHeader(string, indentPerLevel) {
      const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
      const clip = string[string.length - 1] === "\n";
      const keep = clip && (string[string.length - 2] === "\n" || string === "\n");
      const chomp = keep ? "+" : clip ? "" : "-";
      return indentIndicator + chomp + "\n";
    }
    function dropEndingNewline(string) {
      return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
    }
    function foldString(string, width) {
      const lineRe = /(\n+)([^\n]*)/g;
      let result = (function() {
        let nextLF = string.indexOf("\n");
        nextLF = nextLF !== -1 ? nextLF : string.length;
        lineRe.lastIndex = nextLF;
        return foldLine(string.slice(0, nextLF), width);
      })();
      let prevMoreIndented = string[0] === "\n" || string[0] === " ";
      let moreIndented;
      let match;
      while (match = lineRe.exec(string)) {
        const prefix = match[1];
        const line = match[2];
        moreIndented = line[0] === " ";
        result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
        prevMoreIndented = moreIndented;
      }
      return result;
    }
    function foldLine(line, width) {
      if (line === "" || line[0] === " ") return line;
      const breakRe = / [^ ]/g;
      let match;
      let start = 0;
      let end;
      let curr = 0;
      let next = 0;
      let result = "";
      while (match = breakRe.exec(line)) {
        next = match.index;
        if (next - start > width) {
          end = curr > start ? curr : next;
          result += "\n" + line.slice(start, end);
          start = end + 1;
        }
        curr = next;
      }
      result += "\n";
      if (line.length - start > width && curr > start) {
        result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
      } else {
        result += line.slice(start);
      }
      return result.slice(1);
    }
    function escapeString(string) {
      let result = "";
      let char = 0;
      for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        const escapeSeq = ESCAPE_SEQUENCES[char];
        if (!escapeSeq && isPrintable(char)) {
          result += string[i];
          if (char >= 65536) result += string[i + 1];
        } else {
          result += escapeSeq || encodeHex(char);
        }
      }
      return result;
    }
    function writeFlowSequence(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) {
          value = state.replacer.call(object, String(index), value);
        }
        if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
          if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = "[" + _result + "]";
    }
    function writeBlockSequence(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) {
          value = state.replacer.call(object, String(index), value);
        }
        if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
          if (!compact || _result !== "") {
            _result += generateNextLine(state, level);
          }
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            _result += "-";
          } else {
            _result += "- ";
          }
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = _result || "[]";
    }
    function writeFlowMapping(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (_result !== "") pairBuffer += ", ";
        if (state.condenseFlow) pairBuffer += '"';
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object, objectKey, objectValue);
        }
        if (!writeNode(state, level, objectKey, false, false)) {
          continue;
        }
        if (state.dump.length > 1024) pairBuffer += "? ";
        pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
        if (!writeNode(state, level, objectValue, false, false)) {
          continue;
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = "{" + _result + "}";
    }
    function writeBlockMapping(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      if (state.sortKeys === true) {
        objectKeyList.sort();
      } else if (typeof state.sortKeys === "function") {
        objectKeyList.sort(state.sortKeys);
      } else if (state.sortKeys) {
        throw new YAMLException2("sortKeys must be a boolean or a function");
      }
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (!compact || _result !== "") {
          pairBuffer += generateNextLine(state, level);
        }
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object, objectKey, objectValue);
        }
        if (!writeNode(state, level + 1, objectKey, true, true, true)) {
          continue;
        }
        const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
        if (explicitPair) {
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            pairBuffer += "?";
          } else {
            pairBuffer += "? ";
          }
        }
        pairBuffer += state.dump;
        if (explicitPair) {
          pairBuffer += generateNextLine(state, level);
        }
        if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
          continue;
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += ":";
        } else {
          pairBuffer += ": ";
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = _result || "{}";
    }
    function detectType(state, object, explicit) {
      const typeList = explicit ? state.explicitTypes : state.implicitTypes;
      for (let index = 0, length = typeList.length; index < length; index += 1) {
        const type2 = typeList[index];
        if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
          if (explicit) {
            if (type2.multi && type2.representName) {
              state.tag = type2.representName(object);
            } else {
              state.tag = type2.tag;
            }
          } else {
            state.tag = "?";
          }
          if (type2.represent) {
            const style = state.styleMap[type2.tag] || type2.defaultStyle;
            let _result;
            if (_toString.call(type2.represent) === "[object Function]") {
              _result = type2.represent(object, style);
            } else if (_hasOwnProperty.call(type2.represent, style)) {
              _result = type2.represent[style](object, style);
            } else {
              throw new YAMLException2("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
            }
            state.dump = _result;
          }
          return true;
        }
      }
      return false;
    }
    function writeNode(state, level, object, block, compact, iskey, isblockseq) {
      state.tag = null;
      state.dump = object;
      if (!detectType(state, object, false)) {
        detectType(state, object, true);
      }
      const type2 = _toString.call(state.dump);
      const inblock = block;
      if (block) {
        block = state.flowLevel < 0 || state.flowLevel > level;
      }
      const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
      let duplicateIndex;
      let duplicate;
      if (objectOrArray) {
        duplicateIndex = state.duplicates.indexOf(object);
        duplicate = duplicateIndex !== -1;
      }
      if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
        compact = false;
      }
      if (duplicate && state.usedDuplicates[duplicateIndex]) {
        state.dump = "*ref_" + duplicateIndex;
      } else {
        if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
          state.usedDuplicates[duplicateIndex] = true;
        }
        if (type2 === "[object Object]") {
          if (block && Object.keys(state.dump).length !== 0) {
            writeBlockMapping(state, level, state.dump, compact);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowMapping(state, level, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type2 === "[object Array]") {
          if (block && state.dump.length !== 0) {
            if (state.noArrayIndent && !isblockseq && level > 0) {
              writeBlockSequence(state, level - 1, state.dump, compact);
            } else {
              writeBlockSequence(state, level, state.dump, compact);
            }
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowSequence(state, level, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type2 === "[object String]") {
          if (state.tag !== "?") {
            writeScalar(state, state.dump, level, iskey, inblock);
          }
        } else if (type2 === "[object Undefined]") {
          return false;
        } else {
          if (state.skipInvalid) return false;
          throw new YAMLException2("unacceptable kind of an object to dump " + type2);
        }
        if (state.tag !== null && state.tag !== "?") {
          let tagStr = encodeURI(
            state.tag[0] === "!" ? state.tag.slice(1) : state.tag
          ).replace(/!/g, "%21");
          if (state.tag[0] === "!") {
            tagStr = "!" + tagStr;
          } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
            tagStr = "!!" + tagStr.slice(18);
          } else {
            tagStr = "!<" + tagStr + ">";
          }
          state.dump = tagStr + " " + state.dump;
        }
      }
      return true;
    }
    function getDuplicateReferences(object, state) {
      const objects = [];
      const duplicatesIndexes = [];
      inspectNode(object, objects, duplicatesIndexes);
      const length = duplicatesIndexes.length;
      for (let index = 0; index < length; index += 1) {
        state.duplicates.push(objects[duplicatesIndexes[index]]);
      }
      state.usedDuplicates = new Array(length);
    }
    function inspectNode(object, objects, duplicatesIndexes) {
      if (object !== null && typeof object === "object") {
        const index = objects.indexOf(object);
        if (index !== -1) {
          if (duplicatesIndexes.indexOf(index) === -1) {
            duplicatesIndexes.push(index);
          }
        } else {
          objects.push(object);
          if (Array.isArray(object)) {
            for (let i = 0, length = object.length; i < length; i += 1) {
              inspectNode(object[i], objects, duplicatesIndexes);
            }
          } else {
            const objectKeyList = Object.keys(object);
            for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
              inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
            }
          }
        }
      }
    }
    function dump2(input, options) {
      options = options || {};
      const state = new State(options);
      if (!state.noRefs) getDuplicateReferences(input, state);
      let value = input;
      if (state.replacer) {
        value = state.replacer.call({ "": value }, "", value);
      }
      if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
      return "";
    }
    dumper.dump = dump2;
    return dumper;
  }
  var hasRequiredJsYaml;
  function requireJsYaml() {
    if (hasRequiredJsYaml) return jsYaml;
    hasRequiredJsYaml = 1;
    const loader2 = requireLoader();
    const dumper2 = requireDumper();
    function renamed(from, to) {
      return function() {
        throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
      };
    }
    jsYaml.Type = requireType();
    jsYaml.Schema = requireSchema();
    jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
    jsYaml.JSON_SCHEMA = requireJson();
    jsYaml.CORE_SCHEMA = requireCore();
    jsYaml.DEFAULT_SCHEMA = require_default();
    jsYaml.load = loader2.load;
    jsYaml.loadAll = loader2.loadAll;
    jsYaml.dump = dumper2.dump;
    jsYaml.YAMLException = requireException();
    jsYaml.types = {
      binary: requireBinary(),
      float: requireFloat(),
      map: requireMap(),
      null: require_null(),
      pairs: requirePairs(),
      set: requireSet(),
      timestamp: requireTimestamp(),
      bool: requireBool(),
      int: requireInt(),
      merge: requireMerge(),
      omap: requireOmap(),
      seq: requireSeq(),
      str: requireStr()
    };
    jsYaml.safeLoad = renamed("safeLoad", "load");
    jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
    jsYaml.safeDump = renamed("safeDump", "dump");
    return jsYaml;
  }
  var jsYamlExports = requireJsYaml();
  var yaml = /* @__PURE__ */ getDefaultExportFromCjs(jsYamlExports);
  var {
    Type,
    Schema,
    FAILSAFE_SCHEMA,
    JSON_SCHEMA,
    CORE_SCHEMA,
    DEFAULT_SCHEMA,
    load,
    loadAll,
    dump,
    YAMLException,
    types,
    safeLoad,
    safeLoadAll,
    safeDump
  } = yaml;

  // dist/src/parser/index.js
  var MERGED_LISTS = [
    "events",
    "states",
    "transitions",
    "components",
    "resources",
    "parameters",
    "libraries"
  ];
  var MAX_INCLUDE_DEPTH = 32;
  var ParseError = class extends Error {
    constructor(message, line, column) {
      super(message);
      this.line = line;
      this.column = column;
      this.name = "ParseError";
    }
  };
  function describe(origin) {
    return origin ? `"${origin}"` : "The model";
  }
  var Parser = class {
    constructor() {
      this.eventNames = /* @__PURE__ */ new Set();
      this.stateNames = /* @__PURE__ */ new Set();
      this.actionNames = /* @__PURE__ */ new Set();
      this.statePaths = /* @__PURE__ */ new Set();
      this.statesByLeafName = /* @__PURE__ */ new Map();
    }
    /**
     * Parse YAML string into PulseModel
     * Throws ParseError if invalid
     *
     * Pass a resolver in `options` to allow the document to `include` others.
     */
    parse(yamlContent, options = {}) {
      try {
        const raw = this.loadDocument(yamlContent, options.origin ?? null, options, new Set(options.origin ? [options.origin] : []), 0);
        return this.parseProject(raw);
      } catch (error) {
        if (error instanceof YAMLException) {
          throw new ParseError(error.message, error.mark?.line, error.mark?.column);
        }
        if (error instanceof ParseError) {
          throw error;
        }
        throw new ParseError(`Unknown error: ${error}`);
      }
    }
    /**
     * Read a model from a resolver, following includes.
     * `entry` is resolved the same way an include would be.
     */
    parseFrom(entry, resolver) {
      const origin = resolver.resolve(entry, null);
      let content;
      try {
        content = resolver.read(origin);
      } catch (error) {
        throw new ParseError(`Cannot read model "${entry}": ${error instanceof Error ? error.message : error}`);
      }
      return this.parse(content, { origin, resolver });
    }
    // =========================================================================
    // MULTI-FILE LOADING
    // =========================================================================
    /**
     * Load one document and splice in anything it includes.
     *
     * Includes are merged first, in the order listed, and the including file is
     * layered on top - so a file always overrides what it pulls in, and list
     * sections read in a predictable order.
     */
    loadDocument(content, origin, options, seen, depth) {
      if (depth > MAX_INCLUDE_DEPTH) {
        throw new ParseError(`Include nesting deeper than ${MAX_INCLUDE_DEPTH} levels`);
      }
      const doc = load(content) ?? {};
      if (typeof doc !== "object" || Array.isArray(doc)) {
        throw new ParseError(`${describe(origin)} must contain a YAML mapping`);
      }
      if (doc.includes !== void 0 && doc.include === void 0) {
        throw new ParseError(`${describe(origin)} uses "includes"; the key is "include"`);
      }
      const refs = this.includeRefs(doc.include, origin);
      if (refs.length === 0)
        return doc;
      const resolver = options.resolver;
      if (!resolver) {
        throw new ParseError(`${describe(origin)} uses "include", but this parser was given no way to read other files. Load the model from a path (the CLI does this) or supply a resolver.`);
      }
      let merged = {};
      for (const ref of refs) {
        const id = resolver.resolve(ref, origin);
        if (seen.has(id)) {
          throw new ParseError(`Include cycle: "${ref}" is already being loaded (${id})`);
        }
        let included;
        try {
          included = resolver.read(id);
        } catch (error) {
          throw new ParseError(`${describe(origin)} includes "${ref}", which cannot be read: ${error instanceof Error ? error.message : error}`);
        }
        seen.add(id);
        const loaded = this.loadDocument(included, id, options, seen, depth + 1);
        seen.delete(id);
        if (loaded.project !== void 0) {
          throw new ParseError(`Included file "${ref}" declares "project". Only the top-level model may declare it, so the project has one identity.`);
        }
        merged = this.mergeDocuments(merged, loaded);
      }
      return this.mergeDocuments(merged, doc);
    }
    includeRefs(value, origin) {
      if (value === void 0 || value === null)
        return [];
      const list = Array.isArray(value) ? value : [value];
      return list.map((entry) => {
        if (typeof entry !== "string" || !entry.trim()) {
          throw new ParseError(`${describe(origin)} has an include entry that is not a file path`);
        }
        return entry;
      });
    }
    /**
     * Combine two raw documents. List sections concatenate so several files can
     * each contribute states or events; everything else is overridden by the
     * later document.
     */
    mergeDocuments(base, overlay) {
      const result = { ...base, ...overlay };
      delete result.include;
      const baseSystem = base.system;
      const overlaySystem = overlay.system;
      if (!baseSystem || !overlaySystem)
        return result;
      const system = { ...baseSystem, ...overlaySystem };
      for (const key of MERGED_LISTS) {
        const left = baseSystem[key];
        const right = overlaySystem[key];
        if (Array.isArray(left) && Array.isArray(right)) {
          system[key] = [...left, ...right];
        }
      }
      result.system = system;
      return result;
    }
    // =========================================================================
    // PARSING
    // =========================================================================
    parseProject(raw) {
      const projectRaw = raw.project;
      if (!projectRaw) {
        throw new ParseError('Missing "project" section');
      }
      const systemRaw = raw.system;
      if (!systemRaw) {
        throw new ParseError('Missing "system" section');
      }
      const system = this.parseSystem(systemRaw);
      return {
        name: projectRaw.name || "unnamed",
        version: projectRaw.version || "0.1.0",
        description: projectRaw.description,
        system
      };
    }
    parseSystem(raw) {
      this.eventNames.clear();
      this.stateNames.clear();
      this.actionNames.clear();
      this.statePaths.clear();
      this.statesByLeafName.clear();
      const events = this.parseEvents(raw.events);
      events.forEach((e) => this.eventNames.add(e.name));
      const states = this.parseStates(raw.states);
      this.indexStateNames(states);
      const actions = raw.actions;
      if (actions) {
        Object.keys(actions).forEach((name) => this.actionNames.add(name));
      }
      const transitions = this.parseTransitions(raw.transitions);
      const components = this.parseComponents(raw.components);
      const resources = this.parseResources(raw.resources);
      const parameters = this.parseParameters(raw.parameters);
      const libraries = this.parseLibraries(raw.libraries);
      this.assertUniqueNames(events, "event");
      this.assertUniqueNames(components, "component");
      this.assertUniqueNames(resources, "resource");
      this.assertUniqueNames(parameters, "parameter");
      this.assertUniqueNames(libraries, "library");
      const libraryNames = new Set((libraries || []).map((l) => l.name));
      for (const resource of resources || []) {
        if (resource.library && !libraryNames.has(resource.library)) {
          throw new ParseError(`Resource "${resource.name}" needs library "${resource.library}", which is not declared`);
        }
      }
      return {
        name: raw.name || "unnamed",
        version: raw.version,
        description: raw.description,
        events,
        states,
        transitions,
        components,
        resources,
        parameters,
        libraries
      };
    }
    assertUniqueNames(items, kind) {
      if (!items)
        return;
      const seen = /* @__PURE__ */ new Set();
      for (const item of items) {
        if (seen.has(item.name)) {
          throw new ParseError(`Duplicate ${kind} "${item.name}" (check whether two included files both declare it)`);
        }
        seen.add(item.name);
      }
    }
    parseLibraries(raw) {
      if (!raw || !Array.isArray(raw))
        return void 0;
      return raw.map((entry) => {
        if (typeof entry === "string") {
          return { name: entry };
        }
        const name = entry.name;
        if (typeof name !== "string" || !name.trim()) {
          throw new ParseError('Library requires a "name"');
        }
        const source2 = entry.source;
        if (source2 && !["builtin", "registry", "git", "local"].includes(source2)) {
          throw new ParseError(`Library "${name}" has unknown source "${source2}" (expected builtin, registry, git or local)`);
        }
        if ((source2 === "git" || source2 === "local") && !entry.url) {
          throw new ParseError(`Library "${name}" has source "${source2}" but no "url"`);
        }
        return {
          name,
          include: entry.include,
          version: entry.version,
          source: source2,
          url: entry.url,
          description: entry.description
        };
      });
    }
    parseEvents(raw) {
      if (!raw || !Array.isArray(raw))
        return [];
      return raw.map((e) => ({
        name: e.name,
        source: e.source || "external",
        description: e.description,
        payload: e.payload
      }));
    }
    parseStates(raw) {
      if (!raw || !Array.isArray(raw))
        return [];
      return raw.map((s) => this.parseState(s));
    }
    parseState(raw) {
      const type2 = raw.type || "simple";
      const state = {
        name: raw.name,
        type: type2,
        description: raw.description
      };
      if (type2 === "composite" || type2 === "orthogonal") {
        state.initial = raw.initial;
        if (raw.regions) {
          state.regions = raw.regions.map((r) => this.parseRegion(r));
        } else if (raw.states) {
          state.regions = [{
            initial: state.initial || "INVALID",
            states: this.parseStates(raw.states)
          }];
        }
      }
      return state;
    }
    parseRegion(raw) {
      return {
        name: raw.name,
        initial: raw.initial,
        states: this.parseStates(raw.states)
      };
    }
    parseTransitions(raw) {
      if (!raw || !Array.isArray(raw))
        return [];
      return raw.map((t) => this.parseTransition(t));
    }
    parseTransition(raw) {
      const source2 = raw.source;
      const event = raw.event;
      const target = raw.target;
      if (event !== "*" && !this.eventNames.has(event)) {
        throw new ParseError(`Transition references unknown event "${event}"`);
      }
      if (source2 !== "*" && !this.hasState(source2)) {
        throw new ParseError(`Transition source "${source2}" ${this.describeBadRef(source2)}`);
      }
      if (target === "*") {
        throw new ParseError('Transition target cannot be the wildcard "*"');
      }
      if (!this.hasState(target)) {
        throw new ParseError(`Transition target "${target}" ${this.describeBadRef(target)}`);
      }
      const guard = raw.guard !== void 0 && raw.guard !== null ? this.parseGuard(raw.guard) : void 0;
      const actions = raw.actions ? this.parseActions(raw.actions) : void 0;
      return {
        source: source2,
        target,
        event,
        guard,
        actions,
        description: raw.description
      };
    }
    parseGuard(raw) {
      if (typeof raw === "string") {
        if (!raw.trim()) {
          throw new ParseError("Guard name cannot be empty");
        }
        return { name: raw };
      }
      if (typeof raw !== "object") {
        throw new ParseError(`Guard must be a name or a mapping, got ${typeof raw}`);
      }
      const obj = raw;
      if (obj.expression !== void 0 || obj.type !== void 0 || obj.evaluator !== void 0) {
        throw new ParseError('Guards no longer take "type", "expression" or "evaluator". A guard is the name of a function you implement in C. Use:\n  guard: my_guard_name\nor, to keep the intent as documentation:\n  guard:\n    name: my_guard_name\n    description: what this checks');
      }
      const name = obj.name;
      if (typeof name !== "string" || !name.trim()) {
        throw new ParseError('Guard requires a "name"');
      }
      return {
        name,
        description: obj.description
      };
    }
    parseActions(raw) {
      return raw.map((a) => {
        if (typeof a === "string") {
          return {
            type: "driver",
            driver: a
          };
        }
        return {
          type: a.type || "driver",
          driver: a.driver,
          params: a.params
        };
      });
    }
    parseComponents(raw) {
      if (!raw || !Array.isArray(raw))
        return void 0;
      return raw.map((c) => ({
        name: c.name,
        class: c.class,
        driver: c.driver,
        config: c.config,
        description: c.description
      }));
    }
    parseResources(raw) {
      if (!raw || !Array.isArray(raw))
        return void 0;
      const known = [
        "gpio",
        "pwm",
        "adc",
        "uart",
        "i2c",
        "spi",
        "can",
        "onewire",
        "wifi",
        "ethernet",
        "ble",
        "mqtt",
        "custom"
      ];
      return raw.map((r) => {
        const iface = r.interface;
        if (!iface) {
          throw new ParseError(`Resource "${r.name}" has no "interface"`);
        }
        if (!known.includes(iface)) {
          throw new ParseError(`Resource "${r.name}" has unknown interface "${iface}". Expected one of: ${known.join(", ")}.`);
        }
        return {
          name: r.name,
          interface: iface,
          binding: r.binding,
          library: r.library,
          description: r.description
        };
      });
    }
    parseParameters(raw) {
      if (!raw || !Array.isArray(raw))
        return void 0;
      return raw.map((p) => ({
        name: p.name,
        type: p.type,
        default: p.default,
        min: p.min,
        max: p.max,
        unit: p.unit,
        description: p.description
      }));
    }
    // =========================================================================
    // VALIDATION
    // =========================================================================
    /**
     * Index every state by both its bare name and its full hierarchical path,
     * so references can be checked exactly rather than by top-level prefix.
     */
    indexStateNames(states, prefix = "") {
      states.forEach((state) => {
        if (!state.name) {
          throw new ParseError(`Encountered a state without a name under "${prefix || "<root>"}"`);
        }
        const path = prefix ? `${prefix}/${state.name}` : state.name;
        if (this.statePaths.has(path)) {
          throw new ParseError(`Duplicate state path "${path}"`);
        }
        this.stateNames.add(state.name);
        this.statePaths.add(path);
        const sameName = this.statesByLeafName.get(state.name) || [];
        sameName.push(path);
        this.statesByLeafName.set(state.name, sameName);
        if (state.regions) {
          state.regions.forEach((region) => {
            this.indexStateNames(region.states, path);
          });
        }
      });
    }
    /**
     * Check if a state exists. Accepts a full path ("running/heating") or a bare
     * leaf name ("heating") when that name is unique across the hierarchy.
     */
    hasState(ref) {
      if (ref === "*")
        return true;
      if (this.statePaths.has(ref))
        return true;
      const candidates = this.statesByLeafName.get(ref);
      return candidates !== void 0 && candidates.length === 1;
    }
    /**
     * Explain why a reference failed, so the error points at the real problem
     * rather than just saying the state is unknown.
     */
    describeBadRef(ref) {
      const candidates = this.statesByLeafName.get(ref);
      if (candidates && candidates.length > 1) {
        return `is ambiguous; it matches ${candidates.join(", ")}. Use a full path.`;
      }
      return "does not exist";
    }
  };

  // dist/src/codegen/interfaces.js
  var SECRET_KEY = /(pass|password|secret|token|psk|credential|apikey|api_key)/i;
  var BUILTIN = (name, include, reason) => ({ name, include, source: "builtin", reason });
  var REGISTRY = (name, include, reason) => ({ name, include, source: "registry", reason });
  var CONSUMED_KEYS = {
    gpio: ["mode"],
    uart: ["port"],
    mqtt: ["tls"]
  };
  var KNOWN_KEYS = {
    gpio: ["pin", "pins", "mode"],
    pwm: ["pin", "channel", "frequency", "resolution"],
    adc: ["pin", "attenuation", "resolution"],
    uart: ["port", "baud", "rx", "tx"],
    i2c: ["sda", "scl", "frequency", "address"],
    spi: ["sck", "miso", "mosi", "cs", "frequency"],
    can: ["tx", "rx", "bitrate"],
    onewire: ["pin"],
    wifi: ["ssid", "password", "hostname"],
    ethernet: ["cs", "mac"],
    ble: ["name", "service"],
    mqtt: ["host", "port", "prefix", "tls", "username", "password", "client_id"],
    custom: []
  };
  var InterfaceBackend = class {
    /** Emit everything a single resource contributes to the sketch. */
    emit(resource, symbol) {
      const binding = resource.binding || {};
      const kind = String(resource.interface);
      const out = {
        defines: this.defines(kind, binding, symbol),
        globals: [],
        init: [],
        libraries: [],
        todos: []
      };
      const has = (key) => binding[key] !== void 0 && !SECRET_KEY.test(key);
      const ref = (key) => `${symbol}_${key.toUpperCase()}`;
      switch (kind) {
        case "i2c":
          out.libraries.push(BUILTIN("Wire", "Wire.h", "I2C"));
          out.init.push(...guarded(has("sda") && has("scl") ? `Wire.begin(${ref("sda")}, ${ref("scl")});` : "Wire.begin();", "Wire.begin();"));
          if (has("frequency"))
            out.init.push(`Wire.setClock(${ref("frequency")});`);
          break;
        case "spi":
          out.libraries.push(BUILTIN("SPI", "SPI.h", "SPI"));
          out.init.push(...guarded(has("sck") && has("miso") && has("mosi") ? `SPI.begin(${ref("sck")}, ${ref("miso")}, ${ref("mosi")}${has("cs") ? `, ${ref("cs")}` : ""});` : "SPI.begin();", "SPI.begin();"));
          if (has("cs"))
            out.init.push(`pinMode(${ref("cs")}, OUTPUT);`);
          break;
        case "uart": {
          const port = binding.port === void 0 ? 1 : Number(binding.port);
          const serial = port === 0 ? "Serial" : `Serial${port}`;
          const baud = has("baud") ? ref("baud") : "115200";
          out.init.push(...guarded(has("rx") && has("tx") ? `${serial}.begin(${baud}, SERIAL_8N1, ${ref("rx")}, ${ref("tx")});` : `${serial}.begin(${baud});`, `${serial}.begin(${baud});`));
          break;
        }
        case "pwm":
          if (has("pin") && has("channel")) {
            out.init.push("#ifdef ARDUINO_ARCH_ESP32", `  ledcSetup(${ref("channel")}, ${has("frequency") ? ref("frequency") : "5000"}, ${has("resolution") ? ref("resolution") : "8"});`, `  ledcAttachPin(${ref("pin")}, ${ref("channel")});`, "#endif");
          } else if (has("pin")) {
            out.init.push(`pinMode(${ref("pin")}, OUTPUT);`);
          }
          break;
        case "adc":
          if (has("pin"))
            out.init.push(`pinMode(${ref("pin")}, INPUT);`);
          break;
        case "gpio":
          if (has("pin")) {
            const mode = String(binding.mode || "OUTPUT").toUpperCase();
            out.init.push(`pinMode(${ref("pin")}, ${mode === "PWM" ? "OUTPUT" : mode});`);
          }
          break;
        case "onewire":
          out.libraries.push(REGISTRY("OneWire", "OneWire.h", "OneWire"));
          if (has("pin")) {
            out.globals.push(`OneWire ${lower(symbol)}(${ref("pin")});`);
          } else {
            out.todos.push(`${resource.name}: OneWire needs a "pin" binding`);
          }
          break;
        case "wifi":
          out.libraries.push(BUILTIN("WiFi", "WiFi.h", "Wi-Fi"));
          out.defines.push(...this.secretPlaceholder(binding, symbol, "password"));
          out.init.push(has("hostname") ? `WiFi.setHostname(${ref("hostname")});` : "", `WiFi.begin(${has("ssid") ? ref("ssid") : '""'}, ${symbol}_PASSWORD);`, "// Blocking here would stall fsm.update(); poll WiFi.status() instead.");
          break;
        case "ethernet":
          out.libraries.push(REGISTRY("Ethernet", "Ethernet.h", "Ethernet"));
          out.todos.push(`${resource.name}: call Ethernet.begin() with your MAC/DHCP settings`);
          break;
        case "ble":
          out.libraries.push(BUILTIN("BLEDevice", "BLEDevice.h", "BLE"));
          out.todos.push(`${resource.name}: set up BLE services and characteristics`);
          break;
        case "mqtt": {
          const secure = binding.tls === true;
          out.libraries.push(secure ? BUILTIN("WiFiClientSecure", "WiFiClientSecure.h", "TLS MQTT transport") : BUILTIN("WiFi", "WiFi.h", "MQTT transport"));
          out.libraries.push(REGISTRY("PubSubClient", "PubSubClient.h", "MQTT"));
          const client = `${lower(symbol)}Transport`;
          out.globals.push(`${secure ? "WiFiClientSecure" : "WiFiClient"} ${client};`, `PubSubClient ${lower(symbol)}(${client});`);
          if (secure) {
            out.globals.push(`// TODO: ${client}.setCACert(...) before connecting. Skipping`, "// verification would defeat the point of TLS.");
          }
          out.init.push(`${lower(symbol)}.setServer(${has("host") ? ref("host") : '""'}, ${has("port") ? ref("port") : secure ? 8883 : 1883});`);
          out.todos.push(`${resource.name}: connect and re-connect without blocking, and call ${lower(symbol)}.loop() every iteration`);
          break;
        }
        case "can":
          out.todos.push(`${resource.name}: CAN has no single Arduino API - declare the library your board needs and initialise it here`);
          break;
        default:
          out.todos.push(`${resource.name}: custom interface, initialise it here`);
          break;
      }
      out.init = out.init.filter(Boolean);
      for (const key of Object.keys(binding)) {
        if (SECRET_KEY.test(key)) {
          out.todos.push(`${resource.name}: set ${symbol}_${key.toUpperCase()} before building`);
        }
      }
      return out;
    }
    /**
     * A blank credential macro, emitted when generated code has to reference one
     * that the model did not supply. Defining it here keeps the sketch building
     * while still forcing the user to fill it in.
     */
    secretPlaceholder(binding, symbol, key) {
      if (binding[key] !== void 0)
        return [];
      return [`#define ${symbol}_${key.toUpperCase()} ""  // TODO: set this; do not commit secrets to the model`];
    }
    /** Libraries the model declares explicitly, normalised for emission. */
    declared(libraries) {
      return (libraries || []).map((library) => ({
        name: library.name,
        include: library.include || `${library.name}.h`,
        source: library.source === "builtin" ? "builtin" : "registry",
        reason: library.description || "declared in the model"
      }));
    }
    defines(kind, binding, symbol) {
      const known = KNOWN_KEYS[kind] ?? [];
      const consumed = CONSUMED_KEYS[kind] ?? [];
      const lines = [];
      for (const [key, value] of Object.entries(binding)) {
        const name = `${symbol}_${key.toUpperCase()}`;
        if (consumed.includes(key))
          continue;
        if (SECRET_KEY.test(key)) {
          lines.push(`#define ${name} ""  // TODO: set this; do not commit secrets to the model`);
          continue;
        }
        if (!known.includes(key)) {
          lines.push(`// ${key}: ${JSON.stringify(value)}  (not used by the ${kind} backend)`);
          continue;
        }
        lines.push(`#define ${name} ${literal(value)}`);
      }
      return lines;
    }
  };
  function guarded(preferred, fallback) {
    if (preferred === fallback)
      return [preferred];
    return [
      "#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266) || defined(ARDUINO_ARCH_RP2040)",
      `  ${preferred}`,
      "#else",
      `  ${fallback}`,
      "#endif"
    ];
  }
  function literal(value) {
    if (typeof value === "number")
      return String(value);
    if (typeof value === "boolean")
      return value ? "true" : "false";
    const text = String(value);
    const gpio = /^(?:GPIO|IO)[_-]?(\d+)$/i.exec(text);
    if (gpio)
      return `${gpio[1]}  // ${text}`;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) ? text : JSON.stringify(text);
  }
  function lower(symbol) {
    return symbol.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  // dist/src/codegen/index.js
  var CodegenError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "CodegenError";
    }
  };
  var ROOT_PATH = "__root";
  var Codegen = class {
    constructor() {
      this.states = [];
      this.byPath = /* @__PURE__ */ new Map();
      this.byLeafName = /* @__PURE__ */ new Map();
      this.rootIndex = -1;
      this.guards = /* @__PURE__ */ new Map();
      this.guardStubs = /* @__PURE__ */ new Map();
      this.actionNames = /* @__PURE__ */ new Set();
      this.transitionsBySource = /* @__PURE__ */ new Map();
      this.interfaces = new InterfaceBackend();
      this.emissions = /* @__PURE__ */ new Map();
      this.libraries = /* @__PURE__ */ new Map();
    }
    /**
     * Generate C++ code from a validated PulseModel
     */
    generate(project) {
      this.reset();
      this.project = project;
      this.indexStates();
      this.indexGuards();
      this.indexActions();
      this.indexTransitions();
      this.indexInterfaces();
      return [
        this.generateHeader(),
        this.generateIncludes(),
        this.generateInterfaces(),
        this.generateEventEnum(),
        this.generateParameterStruct(),
        this.generateSensorStruct(),
        this.generateContextStruct(),
        this.generateMachineDeclarations(),
        this.generateGuardDeclarations(),
        this.generateActionDeclarations(),
        this.generateEventHandlers(),
        this.generateSetupFunction(),
        this.generateLoopFunction(),
        this.generateGuardImplementations(),
        this.generateActionImplementations()
      ].join("\n\n") + "\n";
    }
    reset() {
      this.states = [];
      this.byPath = /* @__PURE__ */ new Map();
      this.byLeafName = /* @__PURE__ */ new Map();
      this.rootIndex = -1;
      this.guards = /* @__PURE__ */ new Map();
      this.guardStubs = /* @__PURE__ */ new Map();
      this.actionNames = /* @__PURE__ */ new Set();
      this.transitionsBySource = /* @__PURE__ */ new Map();
      this.emissions = /* @__PURE__ */ new Map();
      this.libraries = /* @__PURE__ */ new Map();
    }
    /**
     * Work out what each declared resource contributes, and collect every
     * library needed - both the ones an interface implies and the ones the
     * model declares.
     */
    indexInterfaces() {
      for (const resource of this.project.system.resources || []) {
        const emission = this.interfaces.emit(resource, this.sanitizeUpper(resource.name));
        this.emissions.set(resource.name, emission);
        for (const library of emission.libraries) {
          if (!this.libraries.has(library.name))
            this.libraries.set(library.name, library);
        }
      }
      for (const library of this.interfaces.declared(this.project.system.libraries)) {
        this.libraries.set(library.name, library);
      }
    }
    // =========================================================================
    // HEADER
    // =========================================================================
    generateHeader() {
      const { name, version } = this.project;
      const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const maxStates = this.states.length + 2;
      const maxEvents = this.nextPowerOfTwo(Math.max(8, this.project.system.events.length));
      const levels = Math.max(1, ...this.states.map((s) => s.depth + 1));
      return `/**
 * PulseHSM Generated Code
 *
 * Project: ${name}
 * Version: ${version}
 * Generated: ${date}
 *
 * This file was auto-generated from a PulseHSM model.
 * DO NOT EDIT MANUALLY - regenerate from source instead.
 *
 * Guard/action signatures follow FUNCTION_CONTRACT.md:
 *   bool guard_<name>(const SystemContext* ctx)
 *   void action_<name>(SystemContext* ctx)
 */

// Sized from the model. These must stay above the include to take effect.
#define PULSEHSM_MAX_STATES  ${maxStates}   // ${this.states.length} states + headroom
#define PULSEHSM_MAX_EVENTS  ${maxEvents}   // ring buffer, must be a power of two
#define PULSEHSM_MAX_DEPTH   ${levels}   // deepest nesting, including the leaf

#include <Arduino.h>
#include "PulseHSM.h"`;
    }
    // =========================================================================
    // LIBRARY INCLUDES
    // =========================================================================
    generateIncludes() {
      if (this.libraries.size === 0) {
        return `// ============================================================================
// LIBRARIES
// ============================================================================

// No external libraries required.`;
      }
      const libraries = Array.from(this.libraries.values()).sort((a, b) => a.name.localeCompare(b.name));
      const includes = libraries.map((l) => `#include <${l.include}>`).join("\n");
      const install = libraries.map((l) => {
        const via = l.source === "builtin" ? "bundled with the board core" : "install via Library Manager / lib_deps";
        return `//   ${l.name.padEnd(16)} ${via}  (${l.reason})`;
      }).join("\n");
      return `// ============================================================================
// LIBRARIES
// ============================================================================
//
// Required before this sketch will build:
${install}

${includes}`;
    }
    // =========================================================================
    // INTERFACES
    // =========================================================================
    generateInterfaces() {
      const resources = this.project.system.resources || [];
      if (resources.length === 0) {
        return `// ============================================================================
// INTERFACES
// ============================================================================

// No resources declared.

void setupInterfaces() {}`;
      }
      const blocks = [];
      const globals = [];
      const body = [];
      const todos = [];
      for (const resource of resources) {
        const emission = this.emissions.get(resource.name);
        if (!emission)
          continue;
        const heading = `// ${resource.name} (${resource.interface})` + (resource.description ? ` - ${resource.description}` : "");
        if (emission.defines.length > 0) {
          blocks.push([heading, ...emission.defines].join("\n"));
        } else {
          blocks.push(heading);
        }
        globals.push(...emission.globals);
        if (emission.init.length > 0) {
          body.push(`  // ${resource.name}`);
          body.push(...emission.init.map((line) => line.startsWith("#") ? line : `  ${line}`));
          body.push("");
        }
        todos.push(...emission.todos);
      }
      const todoBlock = todos.length > 0 ? `//
// Still yours to finish:
${todos.map((t) => `//   - ${t}`).join("\n")}
` : "";
      return `// ============================================================================
// INTERFACES
// ============================================================================
//
// Pin arguments to begin() require an ESP32/ESP8266/RP2040 core; the fallbacks
// below cover cores without them. Adjust setupInterfaces() for other boards.
${todoBlock}
${blocks.join("\n\n")}
${globals.length > 0 ? `
${globals.join("\n")}
` : ""}
void setupInterfaces() {
${body.length > 0 ? body.join("\n").replace(/\n+$/, "") : "  // Nothing to initialise"}
}`;
    }
    // =========================================================================
    // EVENT ENUM
    // =========================================================================
    generateEventEnum() {
      const events = this.project.system.events;
      if (events.length === 0) {
        throw new CodegenError("System defines no events; nothing to dispatch");
      }
      if (events.length > 256) {
        throw new CodegenError("PulseHSM event IDs are uint8_t; at most 256 events are supported");
      }
      const eventNames = events.map((e) => this.sanitizeUpper(e.name));
      const enumValues = eventNames.map((name, idx) => `  EVENT_${name} = ${idx}`).join(",\n");
      return `// ============================================================================
// EVENT DEFINITIONS
// ============================================================================

// uint8_t to match PulseHSM::sendEvent / EventCb.
enum SystemEvent : uint8_t {
${enumValues}
};

const char* eventNames[] = {
${eventNames.map((name) => `  "${name}"`).join(",\n")}
};`;
    }
    // =========================================================================
    // SYSTEM PARAMETERS (from YAML)
    // =========================================================================
    generateParameterStruct() {
      const parameters = this.project.system.parameters || [];
      if (parameters.length === 0) {
        return `// ============================================================================
// SYSTEM PARAMETERS
// ============================================================================

// No parameters defined in the model.
struct SystemParameters {};

SystemParameters systemParameters = {};`;
      }
      const fields = parameters.map((p) => {
        const unit = p.unit ? `  // ${p.unit}` : "";
        return `  ${this.cType(p)} ${this.sanitize(p.name)};${unit}`;
      }).join("\n");
      const inits = parameters.map((p, idx) => {
        const comma = idx < parameters.length - 1 ? "," : "";
        return `  ${this.cLiteral(p)}${comma}   // ${this.sanitize(p.name)}`;
      }).join("\n");
      return `// ============================================================================
// SYSTEM PARAMETERS
// ============================================================================

// Generated from the model's "parameters" section.
struct SystemParameters {
${fields}
};

// Initialized with the defaults declared in the model.
SystemParameters systemParameters = {
${inits}
};`;
    }
    // =========================================================================
    // SYSTEM SENSORS (user fills in)
    // =========================================================================
    generateSensorStruct() {
      const sensors = (this.project.system.components || []).filter((c) => String(c.class) === "sensor");
      const fields = sensors.length > 0 ? sensors.map((c) => `  float ${this.sanitize(c.name)};  // driver: ${c.driver}`).join("\n") : "  // TODO: Add your sensor readings here (e.g. float temperature;)";
      return `// ============================================================================
// SYSTEM SENSORS
// ============================================================================

// One field per sensor component in the model. Populate these from real
// hardware reads in loop() - the generator never reads hardware for you.
struct SystemSensors {
${fields}
};

SystemSensors systemSensors = {};`;
    }
    // =========================================================================
    // SYSTEM CONTEXT
    // =========================================================================
    generateContextStruct() {
      return `// ============================================================================
// SYSTEM CONTEXT (see FUNCTION_CONTRACT.md)
// ============================================================================

struct SystemContext {
  int currentState;                    // Current state index (compare with S_*)
  int previousState;                   // Previous state index (-1 before first transition)
  int32_t eventData;                   // Payload of the event being dispatched
  const SystemParameters* parameters;  // Read-only system parameters
  const SystemSensors* sensors;        // Current sensor readings
};

SystemContext systemContext;`;
    }
    // =========================================================================
    // MACHINE + STATE INDEX GLOBALS
    // =========================================================================
    generateMachineDeclarations() {
      const indices = this.states.map((s) => `int ${s.symbol} = -1;${s.path === ROOT_PATH ? "  // synthetic root for wildcard transitions" : `  // ${s.path}`}`).join("\n");
      return `// ============================================================================
// STATE MACHINE
// ============================================================================

PulseHSM fsm;

// State indices returned by addState(). Globals, per the PulseHSM contract.
${indices}`;
    }
    // =========================================================================
    // GUARD / ACTION DECLARATIONS
    // =========================================================================
    generateGuardDeclarations() {
      if (this.guardStubs.size === 0) {
        return `// ============================================================================
// GUARD DECLARATIONS
// ============================================================================

// No guards defined`;
      }
      const declarations = Array.from(this.guardStubs.keys()).map((fnName) => `bool ${fnName}(const SystemContext* ctx);`).join("\n");
      return `// ============================================================================
// GUARD DECLARATIONS
// ============================================================================

${declarations}`;
    }
    generateActionDeclarations() {
      if (this.actionNames.size === 0) {
        return `// ============================================================================
// ACTION DECLARATIONS
// ============================================================================

// No actions defined`;
      }
      const declarations = Array.from(this.actionNames).map((name) => `void action_${this.sanitize(name)}(SystemContext* ctx);`).join("\n");
      return `// ============================================================================
// ACTION DECLARATIONS
// ============================================================================

${declarations}`;
    }
    // =========================================================================
    // EVENT HANDLERS (one per state with outgoing transitions)
    // =========================================================================
    generateEventHandlers() {
      const handlers = [];
      for (const flat of this.states) {
        const owned = this.transitionsBySource.get(flat.index);
        if (!owned || owned.length === 0)
          continue;
        handlers.push(this.generateHandler(flat, owned));
      }
      const sync = `// Refresh the context handed to every guard and action.
// Called at the top of each handler so guards see the live machine state.
static void syncContext() {
  systemContext.currentState = fsm.getCurrentState();
  systemContext.previousState = fsm.getPreviousState();
  systemContext.eventData = fsm.getEventData();
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
}`;
      if (handlers.length === 0) {
        return `// ============================================================================
// EVENT HANDLERS
// ============================================================================

${sync}

// No transitions defined`;
      }
      return `// ============================================================================
// EVENT HANDLERS
// ============================================================================
//
// Returning true consumes the event. Returning false lets it bubble to the
// enclosing state, which is what makes an inner transition outrank an outer
// one on the same event.

${sync}

${handlers.join("\n\n")}`;
    }
    generateHandler(flat, owned) {
      const transitions = this.project.system.transitions;
      const byEvent = /* @__PURE__ */ new Map();
      for (const idx of owned) {
        const event = transitions[idx].event;
        const list = byEvent.get(event) || [];
        list.push(idx);
        byEvent.set(event, list);
      }
      const cases = [];
      for (const [event, indices] of byEvent) {
        const body = [];
        let shadowed = false;
        for (const idx of indices) {
          if (shadowed) {
            const t2 = transitions[idx];
            body.push(`      // Unreachable: an earlier unguarded transition on this event
      // always fires first (-> ${t2.target}).`);
            break;
          }
          const t = transitions[idx];
          const guard = this.guards.get(idx);
          const target = this.states[this.resolveEntry(this.resolveRef(t.target, "target"))];
          const calls = (t.actions || []).map((a) => `        action_${this.sanitize(a.driver)}(&systemContext);`).join("\n");
          const fire = [
            calls,
            `        fsm.transitionTo(${target.symbol});`,
            "        return true;"
          ].filter(Boolean).join("\n");
          if (guard) {
            body.push(`      if (${guard.fnName}(&systemContext)) {
${fire}
      }`);
          } else {
            body.push(`      {
${fire}
      }`);
            shadowed = true;
          }
        }
        cases.push(`    case EVENT_${this.sanitizeUpper(event)}:
${body.join("\n")}
      break;`);
      }
      const label = flat.path === ROOT_PATH ? 'wildcard transitions (source: "*")' : `state "${flat.path}"`;
      return `// Handles ${label}.
bool ${this.handlerName(flat)}(uint8_t event) {
  syncContext();

  switch (event) {
${cases.join("\n")}
    default:
      break;
  }

  return false;  // not handled here - let it bubble
}`;
    }
    handlerName(flat) {
      return `onEvent_${this.sanitize(flat.path)}`;
    }
    // =========================================================================
    // SETUP
    // =========================================================================
    generateSetupFunction() {
      if (this.states.length === 0) {
        throw new CodegenError("System defines no states; nothing to generate");
      }
      const components = this.project.system.components || [];
      const gpioComponents = components.filter((c) => c.driver.includes("gpio"));
      const componentComments = components.length > 0 ? components.map((c) => {
        const pin = c.config?.pin ? ` - pin ${c.config.pin}` : "";
        return `// Component: ${c.name} (${c.class})${pin}`;
      }).join("\n") : "// No components defined";
      const initCode = gpioComponents.map((c) => {
        const pin = c.config?.pin || "GPIO_PIN";
        return `  // pinMode(${pin}, OUTPUT);  // ${c.name}`;
      }).join("\n");
      const registrations = this.states.map((flat) => {
        const handler = this.transitionsBySource.get(flat.index)?.length ? this.handlerName(flat) : "nullptr";
        const parent = flat.parent === -1 ? "-1" : this.states[flat.parent].symbol;
        return `  ${flat.symbol} = fsm.addState(
      "${flat.path}",
      nullptr,   // update
      nullptr,   // entry
      nullptr,   // exit
      0,         // timeoutMs
      -1,        // timeoutNext
      ${handler},  // onEvent
      ${parent});`;
      }).join("\n\n");
      const firstTopLevel = this.states.findIndex((s) => s.parent === -1 && s.path !== ROOT_PATH);
      const rootRelative = this.rootIndex !== -1 ? this.states.findIndex((s) => s.parent === this.rootIndex) : firstTopLevel;
      const startIndex = this.resolveEntry(rootRelative === -1 ? 0 : rootRelative);
      return `// ============================================================================
// SETUP
// ============================================================================

${componentComments}

void setup() {
  Serial.begin(115200);
  Serial.println("\\n\\n=== ${this.project.name} v${this.project.version} ===");

  // Buses and peripherals declared as resources
  setupInterfaces();

  // Initialize components
${initCode || "  // Initialize pins and peripherals here"}

  // Wire up the context handed to every guard and action
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;

  // Register states. Parents are registered before their children.
${registrations}

  // begin() must be given a leaf state.
  fsm.begin(${this.states[startIndex].symbol});

  Serial.print("Initial state: ");
  Serial.println(fsm.getCurrentName());
}`;
    }
    // =========================================================================
    // LOOP
    // =========================================================================
    generateLoopFunction() {
      const example = this.project.system.events[0];
      const exampleName = example ? `EVENT_${this.sanitizeUpper(example.name)}` : "EVENT_NONE";
      return `// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // TODO: Read sensors into systemSensors, then raise events.
  // Example:
  //   systemSensors.temperature = readTemperature();
  //   if (systemSensors.temperature >= systemParameters.setpoint) {
  //     fsm.sendEvent(${exampleName});
  //   }
  //
  // sendEvent() is ISR-safe, so interrupts may call it directly.
  // Never call delay() here - it starves fsm.update().

  fsm.update();
}`;
    }
    // =========================================================================
    // GUARD IMPLEMENTATIONS
    // =========================================================================
    generateGuardImplementations() {
      if (this.guardStubs.size === 0) {
        return `// ============================================================================
// GUARD IMPLEMENTATIONS
// ============================================================================

// No guards defined`;
      }
      const implementations = Array.from(this.guardStubs.entries()).map(([fnName, binding]) => {
        const intent = binding.description ? `  // Intent: ${binding.description}
  //
` : "";
        return `bool ${fnName}(const SystemContext* ctx) {
${intent}  // TODO: Implement this check using ctx->sensors, ctx->parameters,
  //       ctx->currentState and ctx->eventData.
  (void)ctx;
  return false;
}`;
      }).join("\n\n");
      return `// ============================================================================
// GUARD IMPLEMENTATIONS
// ============================================================================

${implementations}`;
    }
    // =========================================================================
    // ACTION IMPLEMENTATIONS
    // =========================================================================
    generateActionImplementations() {
      if (this.actionNames.size === 0) {
        return `// ============================================================================
// ACTION IMPLEMENTATIONS
// ============================================================================

// No actions defined`;
      }
      const implementations = Array.from(this.actionNames).map((name) => {
        const action = this.project.system.transitions.flatMap((t) => t.actions || []).find((a) => a.driver === name);
        const paramDoc = action?.params ? Object.entries(action.params).map(([k, v]) => `  //   ${k}: ${JSON.stringify(v)}`).join("\n") : "  //   (none)";
        return `void action_${this.sanitize(name)}(SystemContext* ctx) {
  Serial.println("  -> Action: ${name}");
  // Parameters declared in the model (documentation only):
${paramDoc}
  //
  // TODO: Implement the hardware calls for this action.
  (void)ctx;
}`;
      });
      return `// ============================================================================
// ACTION IMPLEMENTATIONS
// ============================================================================

${implementations.join("\n\n")}`;
    }
    // =========================================================================
    // INDEXING
    // =========================================================================
    indexStates() {
      const needsRoot = this.project.system.transitions.some((t) => t.source === "*");
      if (needsRoot) {
        this.rootIndex = 0;
        this.states.push({
          state: null,
          path: ROOT_PATH,
          symbol: "S_ROOT",
          index: 0,
          parent: -1,
          depth: 0,
          initialChild: -1
        });
        this.byPath.set(ROOT_PATH, 0);
      }
      this.flatten(this.project.system.states, this.rootIndex, needsRoot ? 1 : 0, "");
      if (this.states.length > 127) {
        throw new CodegenError(`Model has ${this.states.length} states; PulseHSM supports at most 127`);
      }
      for (const flat of this.states) {
        if (flat.state === null)
          continue;
        const siblings = this.byLeafName.get(flat.state.name) || [];
        const basis = siblings.length === 1 ? flat.state.name : flat.path;
        flat.symbol = `S_${this.sanitizeUpper(basis)}`;
      }
      const seen = /* @__PURE__ */ new Set();
      for (const flat of this.states) {
        if (seen.has(flat.symbol)) {
          throw new CodegenError(`State "${flat.path}" collides with another state on generated symbol ${flat.symbol}`);
        }
        seen.add(flat.symbol);
      }
      for (const flat of this.states) {
        if (flat.state === null)
          continue;
        const initialRef = this.initialRefFor(flat.state);
        if (!initialRef)
          continue;
        const nested = `${flat.path}/${initialRef}`;
        const childIdx = this.byPath.has(nested) ? this.byPath.get(nested) : this.byPath.get(initialRef);
        if (childIdx === void 0) {
          throw new CodegenError(`State "${flat.path}" declares initial child "${initialRef}", which does not exist`);
        }
        flat.initialChild = childIdx;
      }
    }
    flatten(states, parent, depth, prefix) {
      for (const state of states) {
        if (!state.name) {
          throw new CodegenError(`Encountered a state without a name under "${prefix || "<root>"}"`);
        }
        const path = prefix ? `${prefix}/${state.name}` : state.name;
        const index = this.states.length;
        if (this.byPath.has(path)) {
          throw new CodegenError(`Duplicate state path "${path}"`);
        }
        this.states.push({
          state,
          path,
          symbol: "",
          index,
          parent,
          depth,
          initialChild: -1
        });
        this.byPath.set(path, index);
        const sameName = this.byLeafName.get(state.name) || [];
        sameName.push(index);
        this.byLeafName.set(state.name, sameName);
        for (const region of state.regions || []) {
          this.flatten(region.states, index, depth + 1, path);
        }
      }
    }
    /** A composite state's initial child, from either the state or its region. */
    initialRefFor(state) {
      if (state.initial)
        return state.initial;
      const region = state.regions?.[0];
      if (region?.initial && region.initial !== "INVALID")
        return region.initial;
      return void 0;
    }
    indexGuards() {
      this.project.system.transitions.forEach((t, idx) => {
        if (!t.guard)
          return;
        if (!t.guard.name) {
          throw new CodegenError(`Transition ${idx} has a guard without a name`);
        }
        const fnName = `guard_${this.sanitize(t.guard.name)}`;
        const binding = { fnName, description: t.guard.description };
        this.guards.set(idx, binding);
        const existing = this.guardStubs.get(fnName);
        if (!existing) {
          this.guardStubs.set(fnName, binding);
        } else if (!existing.description && binding.description) {
          this.guardStubs.set(fnName, binding);
        }
      });
    }
    indexActions() {
      this.project.system.transitions.forEach((t, idx) => {
        for (const a of t.actions || []) {
          if (!a.driver) {
            throw new CodegenError(`Transition ${idx} has an action without a name`);
          }
          this.actionNames.add(a.driver);
        }
      });
    }
    indexTransitions() {
      this.project.system.transitions.forEach((t, idx) => {
        let sourceIdx;
        if (t.source === "*") {
          if (this.rootIndex === -1) {
            throw new CodegenError("Internal error: wildcard transition without a synthetic root");
          }
          sourceIdx = this.rootIndex;
        } else {
          sourceIdx = this.resolveRef(t.source, "source");
        }
        this.resolveEntry(this.resolveRef(t.target, "target"));
        const list = this.transitionsBySource.get(sourceIdx) || [];
        list.push(idx);
        this.transitionsBySource.set(sourceIdx, list);
      });
    }
    // =========================================================================
    // REFERENCE RESOLUTION
    // =========================================================================
    /**
     * Resolve a StateRef to an index. Accepts a full path ("running/heating")
     * or a bare leaf name ("heating") when that name is unambiguous.
     */
    resolveRef(ref, role) {
      if (ref === "*") {
        throw new CodegenError(`Wildcard "*" is not a valid transition ${role}`);
      }
      const exact = this.byPath.get(ref);
      if (exact !== void 0)
        return exact;
      const candidates = this.byLeafName.get(ref);
      if (candidates && candidates.length === 1)
        return candidates[0];
      if (candidates && candidates.length > 1) {
        const paths = candidates.map((i) => this.states[i].path).join(", ");
        throw new CodegenError(`Transition ${role} "${ref}" is ambiguous; it matches ${paths}. Use a full path.`);
      }
      throw new CodegenError(`Transition ${role} references unknown state "${ref}"`);
    }
    /** Descend a composite state to the leaf that actually becomes active. */
    resolveEntry(index) {
      let current2 = index;
      const seen = /* @__PURE__ */ new Set();
      while (this.states[current2].initialChild !== -1) {
        if (seen.has(current2)) {
          throw new CodegenError(`Cycle in initial-child chain at state "${this.states[current2].path}"`);
        }
        seen.add(current2);
        current2 = this.states[current2].initialChild;
      }
      return current2;
    }
    // =========================================================================
    // HELPERS
    // =========================================================================
    nextPowerOfTwo(n) {
      let value = 1;
      while (value < n)
        value *= 2;
      return value;
    }
    cType(p) {
      switch (p.type) {
        case "float":
          return "float";
        case "int":
          return "int32_t";
        case "bool":
          return "bool";
        case "string":
          return "const char*";
        default:
          throw new CodegenError(`Parameter "${p.name}" has unsupported type "${p.type}"`);
      }
    }
    cLiteral(p) {
      const value = p.default;
      switch (p.type) {
        case "float": {
          const n = Number(value ?? 0);
          if (!Number.isFinite(n)) {
            throw new CodegenError(`Parameter "${p.name}" has a non-numeric default`);
          }
          return `${Number.isInteger(n) ? n.toFixed(1) : String(n)}f`;
        }
        case "int": {
          const n = Number(value ?? 0);
          if (!Number.isInteger(n)) {
            throw new CodegenError(`Parameter "${p.name}" has a non-integer default`);
          }
          return String(n);
        }
        case "bool":
          return value ? "true" : "false";
        case "string":
          return JSON.stringify(String(value ?? ""));
        default:
          throw new CodegenError(`Parameter "${p.name}" has unsupported type "${p.type}"`);
      }
    }
    sanitize(name) {
      const cleaned = String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
      return cleaned || "unnamed";
    }
    sanitizeUpper(name) {
      return this.sanitize(name).toUpperCase();
    }
  };

  // dist/src/analysis/states.js
  function childrenOf(state) {
    return (state.regions || []).flatMap((region) => region.states);
  }
  function flattenStates(states) {
    const out = [];
    const walk = (nodes, parentPath, depth) => {
      for (const state of nodes) {
        const path = parentPath ? `${parentPath}/${state.name}` : state.name;
        const children = childrenOf(state);
        out.push({
          state,
          path,
          parentPath,
          depth,
          isLeaf: children.length === 0,
          initialChildPath: initialChildPathOf(state, path)
        });
        walk(children, path, depth + 1);
      }
    };
    walk(states, null, 0);
    return out;
  }
  function leafPaths(states) {
    return flattenStates(states).filter((s) => s.isLeaf).map((s) => s.path);
  }
  function resolveEntryLeaf(states, path) {
    const byPath = new Map(flattenStates(states).map((s) => [s.path, s]));
    let current2 = byPath.get(path);
    if (!current2)
      return null;
    const seen = /* @__PURE__ */ new Set();
    while (!current2.isLeaf) {
      if (seen.has(current2.path) || !current2.initialChildPath)
        return null;
      seen.add(current2.path);
      const next = byPath.get(current2.initialChildPath);
      if (!next)
        return null;
      current2 = next;
    }
    return current2.path;
  }
  function resolvePath(states, ref) {
    const flat = flattenStates(states);
    if (flat.some((s) => s.path === ref))
      return ref;
    const matches = flat.filter((s) => s.state.name === ref);
    return matches.length === 1 ? matches[0].path : null;
  }
  function initialChildPathOf(state, path) {
    const children = childrenOf(state);
    if (children.length === 0)
      return null;
    const ref = state.initial ?? (state.regions?.[0]?.initial !== "INVALID" ? state.regions?.[0]?.initial : void 0);
    if (!ref)
      return null;
    const qualified = `${path}/${ref}`;
    if (children.some((c) => `${path}/${c.name}` === qualified))
      return qualified;
    if (children.some((c) => `${path}/${c.name}` === ref))
      return ref;
    return null;
  }

  // dist/src/emit/topics.js
  var TopicError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "TopicError";
    }
  };
  var TopicEmitter = class {
    /**
     * Build the manifest. `namespace` defaults to the project name; pass your
     * own (e.g. "pulsecompiler") to match an existing deployment.
     */
    emit(project, namespace) {
      const ns = this.segment(namespace || project.name, "namespace");
      const prefix = `${ns}/{device}`;
      return {
        schema: "pulseir/topics@1",
        project: project.name,
        version: String(project.version),
        prefix,
        payloadFormat: "plain-text-scalar",
        perspective: "device",
        publish: this.publishTopics(project, prefix),
        subscribe: this.subscribeTopics(project, prefix)
      };
    }
    toJSON(project, namespace) {
      return JSON.stringify(this.emit(project, namespace), null, 2) + "\n";
    }
    // =========================================================================
    publishTopics(project, prefix) {
      const topics = [];
      for (const component of project.system.components || []) {
        if (String(component.class) !== "sensor")
          continue;
        const leaf = this.segment(component.name, "sensor");
        const unit = component.config?.unit;
        topics.push({
          topic: `${prefix}/${leaf}`,
          kind: "sensor",
          valueType: "float",
          source: component.name,
          driver: component.driver,
          ...typeof unit === "string" ? { unit } : {}
        });
      }
      const leaves = leafPaths(project.system.states);
      if (leaves.length > 0) {
        topics.push({
          topic: `${prefix}/state`,
          kind: "state",
          valueType: "string",
          values: leaves
        });
      }
      return topics;
    }
    subscribeTopics(project, prefix) {
      const topics = [];
      for (const parameter of project.system.parameters || []) {
        const leaf = this.segment(parameter.name, "parameter");
        topics.push({
          topic: `${prefix}/setpoint/${leaf}`,
          kind: "setpoint",
          valueType: this.valueType(parameter.type),
          parameter: parameter.name,
          ...parameter.unit !== void 0 ? { unit: parameter.unit } : {},
          ...parameter.default !== void 0 ? { default: parameter.default } : {},
          ...parameter.min !== void 0 ? { min: parameter.min } : {},
          ...parameter.max !== void 0 ? { max: parameter.max } : {},
          ...parameter.description !== void 0 ? { description: parameter.description } : {}
        });
      }
      for (const event of project.system.events || []) {
        if (String(event.source) !== "mqtt")
          continue;
        topics.push({
          topic: `${prefix}/event/${this.segment(event.name, "event")}`,
          kind: "command",
          valueType: "trigger",
          event: event.name,
          ...event.description !== void 0 ? { description: event.description } : {}
        });
      }
      return topics;
    }
    // =========================================================================
    valueType(type2) {
      switch (type2) {
        case "float":
          return "float";
        case "int":
          return "int32";
        case "bool":
          return "bool";
        case "string":
          return "string";
        default:
          throw new TopicError(`Parameter has unsupported type "${type2}"`);
      }
    }
    /**
     * MQTT reserves `+` and `#` as wildcards and `/` as the separator, so a name
     * carrying any of them would silently reshape the topic tree.
     */
    segment(name, role) {
      const cleaned = String(name).trim().replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^_+|_+$/g, "");
      if (!cleaned) {
        throw new TopicError(`Cannot build a topic segment from ${role} name "${name}"`);
      }
      return cleaned;
    }
  };

  // dist/web/examples.js
  var EXAMPLES = {
    "starter \u2014 a two-state blinker": '# A minimal model. Edit anything and the panes update as you type.\nproject:\n  name: blinker\n  version: "1.0"\n\nsystem:\n  name: blinker\n\n  events:\n    - name: PRESS\n      source: external\n\n  states:\n    - name: off\n      type: simple\n    - name: on\n      type: simple\n\n  transitions:\n    - source: off\n      event: PRESS\n      target: on\n      actions:\n        - led_on\n\n    - source: on\n      event: PRESS\n      target: off\n      actions:\n        - led_off\n\n  components:\n    - name: led\n      class: actuator\n      driver: gpio_control\n      config:\n        pin: GPIO2\n\n  parameters:\n    - name: blink_ms\n      type: int\n      default: 500\n      unit: ms\n      min: 50\n      max: 5000\n',
    "boiler \u2014 hierarchical states, guards, wildcard stop": 'project:\n  name: boiler_control\n  version: 1.0\n  description: Simple boiler temperature control system\n\nsystem:\n  name: boiler_system\n  description: Controls heating, cooling, and monitoring\n\n  # Events the system responds to\n  events:\n    - name: START\n      source: external\n      description: User presses start button\n\n    - name: STOP\n      source: external\n      description: User presses stop button\n\n    - name: TEMP_REACHED\n      source: sensor\n      description: Temperature sensor indicates setpoint reached\n\n    - name: OVER_TEMP\n      source: sensor\n      description: Temperature exceeds safety limit\n\n    - name: EMERGENCY_STOP\n      source: external\n      description: Emergency stop button pressed\n\n  # States the system can be in\n  states:\n    - name: idle\n      type: simple\n      description: System is off\n\n    - name: running\n      type: composite\n      initial: heating\n      description: System is actively heating/cooling\n      regions:\n        - initial: heating\n          states:\n            - name: heating\n              type: simple\n            - name: maintaining\n              type: simple\n            - name: cooling\n              type: simple\n\n    - name: fault\n      type: simple\n      description: System in fault state\n\n  # Transitions between states\n  transitions:\n    # Idle -> Running\n    - source: idle\n      event: START\n      target: running\n      actions:\n        - start_pump\n      description: Start the system\n\n    # Running -> Idle\n    - source: running\n      event: STOP\n      target: idle\n      actions:\n        - stop_pump\n      description: Stop the system\n\n    # Heating -> Maintaining\n    - source: running/heating\n      event: TEMP_REACHED\n      guard:\n        name: temp_at_setpoint\n        description: water temperature has reached the setpoint\n      target: running/maintaining\n      actions:\n        - reduce_heat\n      description: Temperature reached, switch to maintaining\n\n    # Maintaining -> Cooling (if temp overshoots)\n    - source: running/maintaining\n      event: OVER_TEMP\n      guard:\n        name: over_safe_temp\n        description: temperature has exceeded the safety limit\n      target: running/cooling\n      actions:\n        - activate_cooling\n      description: Temperature too high, cool down\n\n    # Emergency stop from anywhere\n    - source: "*"\n      event: EMERGENCY_STOP\n      target: fault\n      actions:\n        - shutdown_all\n      description: Emergency stop overrides everything\n\n  # Actions that can be triggered\n  actions:\n    start_pump:\n      type: driver\n      driver: gpio_control\n      params:\n        pin: PUMP\n        value: HIGH\n\n    stop_pump:\n      type: driver\n      driver: gpio_control\n      params:\n        pin: PUMP\n        value: LOW\n\n    reduce_heat:\n      type: driver\n      driver: pwm_control\n      params:\n        pin: HEATER\n        value: 25\n\n    activate_cooling:\n      type: driver\n      driver: gpio_control\n      params:\n        pin: COOLING_FAN\n        value: HIGH\n\n    shutdown_all:\n      type: driver\n      driver: shutdown\n      params:\n        all: true\n\n  # Components in the system\n  components:\n    - name: temperature_sensor\n      class: sensor\n      driver: ds18b20\n      config:\n        interface: onewire\n        pin: GPIO4\n      description: Water temperature sensor\n\n    - name: pump\n      class: actuator\n      driver: gpio_control\n      config:\n        pin: GPIO25\n      description: Main circulation pump\n\n    - name: heater\n      class: actuator\n      driver: pwm_control\n      config:\n        pin: GPIO27\n      description: Heating element (PWM controlled)\n\n    - name: cooling_fan\n      class: actuator\n      driver: gpio_control\n      config:\n        pin: GPIO32\n      description: Emergency cooling fan\n\n  # Hardware resources\n  resources:\n    - name: onewire_bus\n      interface: onewire\n      binding:\n        pin: GPIO4\n      description: OneWire bus for temperature sensor\n\n    - name: gpio_pins\n      interface: gpio\n      description: GPIO pins used throughout\n\n    - name: pwm_channels\n      interface: gpio\n      binding:\n        mode: pwm\n      description: PWM channels for heater control\n\n  # System parameters (configuration)\n  parameters:\n    - name: setpoint\n      type: float\n      default: 60.0\n      unit: degC\n      min: 10.0\n      max: 90.0\n      description: Target temperature\n\n    - name: max_safe_temp\n      type: float\n      default: 75.0\n      unit: degC\n      description: Emergency shutdown temperature\n\n    - name: hysteresis\n      type: float\n      default: 2.0\n      unit: degC\n      description: Temperature tolerance band\n',
    "hierarchy \u2014 nesting and inner-vs-outer precedence": "# Fixture exercising the parts of the IR the boiler example does not reach:\n#   - entering a composite state descends to its initial child (recursively)\n#   - a transition on an enclosing state applies to nested children\n#   - an inner transition outranks an enclosing one on the same event\n#   - a transition may carry several actions\n#   - the bare `guard: <name>` shorthand (boiler.yaml covers the mapping form\n#     that carries a description)\n\nproject:\n  name: hierarchy_test\n  version: 1.0\n  description: Hierarchy and dispatch semantics fixture\n\nsystem:\n  name: hierarchy_system\n\n  events:\n    - name: GO\n      source: external\n    - name: NEXT\n      source: internal\n    - name: ABORT\n      source: external\n    - name: BLOCKED\n      source: internal\n\n  states:\n    - name: off\n      type: simple\n\n    - name: active\n      type: composite\n      initial: phase_one\n      regions:\n        - initial: phase_one\n          states:\n            - name: phase_one\n              type: simple\n\n            # Nested two levels deep, so entry has to descend more than once.\n            - name: phase_two\n              type: composite\n              initial: deep\n              regions:\n                - initial: deep\n                  states:\n                    - name: deep\n                      type: simple\n\n    - name: halted\n      type: simple\n\n  transitions:\n    # Target is composite: entry must land on active/phase_one.\n    - source: off\n      event: GO\n      target: active\n      actions:\n        - log_start\n        - arm_system\n\n    # Target is composite and nested: entry must land on active/phase_two/deep.\n    - source: phase_one\n      event: NEXT\n      target: phase_two\n\n    # Enclosing source: applies while any descendant of active is current.\n    - source: active\n      event: ABORT\n      target: halted\n\n    # Inner source on the same event: must outrank the `active` transition\n    # whenever phase_one is the current state.\n    - source: phase_one\n      event: ABORT\n      target: off\n\n    # Named guard; the generated stub returns false, so this stays blocked.\n    - source: phase_one\n      event: BLOCKED\n      target: halted\n      guard: never_ready\n"
  };

  // dist/web/main.js
  var $ = (id) => {
    const el = document.getElementById(id);
    if (!el)
      throw new Error(`missing element #${id}`);
    return el;
  };
  var source = $("source");
  var status = $("status");
  var panes = {
    sketch: $("pane-sketch"),
    topics: $("pane-topics"),
    structure: $("pane-structure")
  };
  var exampleSelect = $("example");
  var namespaceInput = $("namespace");
  var staleNote = $("stale-note");
  var downloadSketch = $("download-sketch");
  var downloadTopics = $("download-topics");
  var current = null;
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function setStale(stale) {
    staleNote.hidden = !stale;
    for (const pane of Object.values(panes))
      pane.classList.toggle("stale", stale);
  }
  function setStatus(kind, title, detail = "") {
    status.className = `status ${kind}`;
    status.innerHTML = `<strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}`;
  }
  function renderStructure(project) {
    const states = project.system.states;
    const flat = flattenStates(states);
    const tree = flat.filter((s) => s.depth === 0).map((s) => renderStateNode(s.path, flat)).join("");
    const rows = project.system.transitions.map((t) => {
      const targetPath = resolvePath(states, t.target);
      const leaf = targetPath ? resolveEntryLeaf(states, targetPath) : null;
      const descends = leaf && targetPath && leaf !== targetPath;
      const target = descends ? `${escapeHtml(t.target)} <span class="arrow">\u21B3</span> <code>${escapeHtml(leaf)}</code>` : escapeHtml(t.target);
      const guard = t.guard ? `<code>${escapeHtml(t.guard.name)}</code>` : '<span class="dim">\u2014</span>';
      const actions = t.actions?.length ? t.actions.map((a) => `<code>${escapeHtml(a.driver)}</code>`).join(" ") : '<span class="dim">\u2014</span>';
      const src = t.source === "*" ? '<span class="tag wild">any state</span>' : `<code>${escapeHtml(t.source)}</code>`;
      return `<tr>
      <td>${src}</td>
      <td><code>${escapeHtml(t.event)}</code></td>
      <td>${target}</td>
      <td>${guard}</td>
      <td>${actions}</td>
    </tr>`;
    }).join("");
    return `
    <h3>State hierarchy</h3>
    <p class="hint">A machine only ever rests in a <em>leaf</em>. Entering a
    composite state descends to its initial child, marked \u25B8.</p>
    <div class="tree">${tree || '<p class="dim">No states defined.</p>'}</div>

    <h3>Transitions</h3>
    <p class="hint">A transition on an enclosing state also applies to its
    children, and an inner transition on the same event wins.</p>
    <table>
      <thead><tr><th>From</th><th>On</th><th>To</th><th>Guard</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="dim">No transitions defined.</td></tr>'}</tbody>
    </table>`;
  }
  function renderStateNode(path, flat) {
    const node = flat.find((s) => s.path === path);
    const children = flat.filter((s) => s.parentPath === path);
    const label = escapeHtml(node.state.name);
    const isInitial = flat.some((s) => s.initialChildPath === path);
    const marker = isInitial ? '<span class="initial" title="initial child">\u25B8</span>' : "";
    if (node.isLeaf) {
      return `<div class="state leaf">${marker}<span>${label}</span></div>`;
    }
    return `<div class="state composite">
    <div class="state-name">${marker}<span>${label}</span>
      <span class="tag">composite</span></div>
    <div class="children">${children.map((c) => renderStateNode(c.path, flat)).join("")}</div>
  </div>`;
  }
  function render() {
    const text = source.value;
    localStorage.setItem("pulseir.source", text);
    let project;
    try {
      project = new Parser().parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const where = error instanceof ParseError && error.line !== void 0 ? ` (line ${error.line + 1})` : "";
      setStatus("error", `Model error${where}`, message);
      setStale(true);
      return;
    }
    let sketch;
    let topics;
    try {
      sketch = new Codegen().generate(project);
      topics = new TopicEmitter().toJSON(project, namespaceInput.value.trim() || void 0);
    } catch (error) {
      setStatus("error", "Generation error", error instanceof Error ? error.message : String(error));
      setStale(true);
      return;
    }
    setStale(false);
    panes.sketch.innerHTML = `<pre><code>${escapeHtml(sketch)}</code></pre>`;
    panes.topics.innerHTML = `<pre><code>${escapeHtml(topics)}</code></pre>`;
    panes.structure.innerHTML = renderStructure(project);
    const counts = [
      `${project.system.states.length} top-level states`,
      `${project.system.events.length} events`,
      `${project.system.transitions.length} transitions`,
      `${sketch.split("\n").length} lines generated`
    ].join(" \xB7 ");
    setStatus("ok", project.name, counts);
    current = { project, sketch, topics };
  }
  function debounce(fn, ms) {
    let handle;
    return () => {
      if (handle !== void 0)
        clearTimeout(handle);
      handle = setTimeout(fn, ms);
    };
  }
  function download(filename, contents, type2) {
    const url = URL.createObjectURL(new Blob([contents], { type: type2 }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  function selectTab(name) {
    for (const [key, pane] of Object.entries(panes)) {
      pane.hidden = key !== name;
    }
    for (const button of document.querySelectorAll(".tab")) {
      button.classList.toggle("active", button.dataset.tab === name);
    }
    localStorage.setItem("pulseir.tab", name);
  }
  function init() {
    for (const key of Object.keys(EXAMPLES)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key;
      exampleSelect.append(option);
    }
    const saved = localStorage.getItem("pulseir.source");
    source.value = saved ?? EXAMPLES[Object.keys(EXAMPLES)[0]];
    const rerender = debounce(render, 150);
    source.addEventListener("input", rerender);
    namespaceInput.addEventListener("input", rerender);
    exampleSelect.addEventListener("change", () => {
      const example = EXAMPLES[exampleSelect.value];
      if (!example)
        return;
      const untouched = !source.value.trim() || Object.values(EXAMPLES).some((text) => text === source.value);
      if (!untouched && !confirm("Replace the current model with this example?")) {
        exampleSelect.value = "";
        return;
      }
      source.value = example;
      render();
    });
    for (const button of document.querySelectorAll(".tab")) {
      button.addEventListener("click", () => selectTab(button.dataset.tab));
    }
    downloadSketch.addEventListener("click", () => {
      if (!current)
        return;
      download(`${current.project.name}.ino`, current.sketch, "text/plain");
    });
    downloadTopics.addEventListener("click", () => {
      if (!current)
        return;
      download("topics.json", current.topics, "application/json");
    });
    source.addEventListener("keydown", (event) => {
      if (event.key !== "Tab")
        return;
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = source;
      source.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      source.selectionStart = source.selectionEnd = selectionStart + 2;
      rerender();
    });
    selectTab(localStorage.getItem("pulseir.tab") || "sketch");
    render();
  }
  init();
})();
