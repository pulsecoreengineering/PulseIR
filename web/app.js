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

  // dist/src/analysis/pins.js
  var PIN_KEYS = ["pin", "sda", "scl", "sck", "miso", "mosi", "cs", "rx", "tx"];
  function normalizePin(value) {
    if (value === null || value === void 0)
      return null;
    if (typeof value === "number") {
      return Number.isInteger(value) ? String(value) : null;
    }
    if (typeof value !== "string")
      return null;
    const text = value.trim();
    if (!text)
      return null;
    const gpio = /^(?:GPIO|IO)[_-]?(\d+)$/i.exec(text);
    if (gpio)
      return gpio[1];
    if (/^\d+$/.test(text))
      return text;
    return text.toUpperCase();
  }
  function collectPinClaims(project) {
    const claims = [];
    const scan = (owner, kind, bag) => {
      if (!bag)
        return;
      for (const role of PIN_KEYS) {
        const pin = normalizePin(bag[role]);
        if (pin === null)
          continue;
        claims.push({ pin, written: String(bag[role]), owner, kind, role });
      }
    };
    for (const bus of project.system.resources || []) {
      scan(bus.name, "bus", bus.binding);
    }
    for (const device of project.system.components || []) {
      scan(device.name, "device", device.config);
    }
    return claims;
  }
  function findPinConflicts(project) {
    const busOf = new Map((project.system.components || []).map((c) => [c.name, c.bus]));
    const byPin = /* @__PURE__ */ new Map();
    for (const claim of collectPinClaims(project)) {
      const list = byPin.get(claim.pin) || [];
      list.push(claim);
      byPin.set(claim.pin, list);
    }
    const conflicts = [];
    for (const [pin, claims] of byPin) {
      if (claims.length < 2)
        continue;
      const independent = claims.filter((claim) => {
        if (claim.kind !== "device")
          return true;
        const bus = busOf.get(claim.owner);
        if (!bus)
          return true;
        return !claims.some((other) => other.kind === "bus" && other.owner === bus);
      });
      const owners = new Set(independent.map((c) => c.owner));
      if (owners.size <= 1)
        continue;
      const busOwners = new Set(independent.filter((c) => c.kind === "bus").map((c) => c.owner));
      const deviceOwners = new Set(independent.filter((c) => c.kind === "device").map((c) => c.owner));
      conflicts.push({
        pin,
        claims: independent,
        busDeviceOnly: busOwners.size === 1 && deviceOwners.size === 1
      });
    }
    return conflicts;
  }
  function describePinConflict(conflict) {
    const lines = conflict.claims.map((c) => `    ${c.written} \u2014 ${c.kind} "${c.owner}" (${c.role})`);
    const hint = conflict.busDeviceOnly ? `
  If the device sits on that bus, say so with "bus: ${conflict.claims.find((c) => c.kind === "bus").owner}" and this stops being a clash.` : "";
    return `Pin ${conflict.pin} is claimed by ${conflict.claims.length} different things:
${lines.join("\n")}${hint}`;
  }

  // dist/src/analysis/template.js
  var TemplateError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "TemplateError";
    }
  };
  function parseTemplate(template) {
    const segments = [];
    let text = "";
    let at = 0;
    const flush = () => {
      if (text)
        segments.push({ kind: "text", value: text });
      text = "";
    };
    while (at < template.length) {
      const ch = template[at];
      if (ch === "{" && template[at + 1] === "{") {
        text += "{";
        at += 2;
        continue;
      }
      if (ch === "}" && template[at + 1] === "}") {
        text += "}";
        at += 2;
        continue;
      }
      if (ch === "}") {
        throw new TemplateError(`Unmatched "}" in ${JSON.stringify(template)}. Write "}}" to print one.`);
      }
      if (ch === "{") {
        const close = template.indexOf("}", at + 1);
        if (close === -1) {
          throw new TemplateError(`Unclosed "{" in ${JSON.stringify(template)}. Write "{{" to print one.`);
        }
        const name = template.slice(at + 1, close).trim();
        if (!name) {
          throw new TemplateError(`Empty "{}" in ${JSON.stringify(template)}`);
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          throw new TemplateError(`"{${name}}" is not a name. A hole prints one declared parameter or sensor; anything else belongs in an action you write.`);
        }
        flush();
        segments.push({ kind: "ref", name });
        at = close + 1;
        continue;
      }
      text += ch;
      at += 1;
    }
    flush();
    return segments;
  }
  function templateRefs(segments) {
    const seen = /* @__PURE__ */ new Set();
    for (const segment of segments) {
      if (segment.kind === "ref")
        seen.add(segment.name);
    }
    return [...seen];
  }

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
  var SCHEMA_VERSION = 1;
  var ParseError = class extends Error {
    constructor(message, line, column) {
      super(message);
      this.line = line;
      this.column = column;
      this.name = "ParseError";
    }
  };
  var BUILTIN_DEVICE_TYPES = {
    digital_output: { class: "actuator", driver: "gpio_control" },
    digital_input: { class: "sensor", driver: "gpio_read" },
    pwm_output: { class: "actuator", driver: "pwm_control" },
    analog_input: { class: "sensor", driver: "adc_read" },
    // Common parts, listed so `type: ds18b20` needs no `class:`.
    ds18b20: { class: "sensor", driver: "ds18b20" },
    dht22: { class: "sensor", driver: "dht22" },
    bme280: { class: "sensor", driver: "bme280" }
  };
  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function describe(origin) {
    return origin ? `"${origin}"` : "The model";
  }
  var Parser = class {
    constructor() {
      this.warnings = [];
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
      this.warnings.length = 0;
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
      if (doc.include !== void 0 && doc.imports === void 0) {
        this.warnings.push(`${describe(origin)} uses "include"; the key is now "imports". Support will be removed in the next release.`);
      }
      if (doc.includes !== void 0 && doc.imports === void 0 && doc.include === void 0) {
        throw new ParseError(`${describe(origin)} uses "includes"; the key is "imports"`);
      }
      const refs = this.includeRefs(doc.imports ?? doc.include, origin);
      if (refs.length === 0)
        return doc;
      const resolver = options.resolver;
      if (!resolver) {
        throw new ParseError(`${describe(origin)} uses "imports", but this parser was given no way to read other files. Load the model from a path (the CLI does this) or supply a resolver.`);
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
      delete result.imports;
      delete result.include;
      for (const key of ["events", "parameters", "actions"]) {
        const merged = this.mergeMaps(base[key], overlay[key], key);
        if (merged !== void 0)
          result[key] = merged;
      }
      for (const [parent, children] of [
        ["hardware", ["buses", "devices"]],
        ["machine", ["states"]]
      ]) {
        const left = base[parent];
        const right = overlay[parent];
        if (!left || !right)
          continue;
        const section = { ...left, ...right };
        for (const child of children) {
          const merged = this.mergeMaps(left[child], right[child], `${parent}.${child}`);
          if (merged !== void 0)
            section[child] = merged;
        }
        if (parent === "machine" && Array.isArray(left.transitions) && Array.isArray(right.transitions)) {
          section.transitions = [...left.transitions, ...right.transitions];
        }
        result[parent] = section;
      }
      if (Array.isArray(base.libraries) && Array.isArray(overlay.libraries)) {
        result.libraries = [...base.libraries, ...overlay.libraries];
      }
      const baseSystem = base.system;
      const overlaySystem = overlay.system;
      if (baseSystem && overlaySystem) {
        const system = { ...baseSystem, ...overlaySystem };
        for (const key of MERGED_LISTS) {
          const left = baseSystem[key];
          const right = overlaySystem[key];
          if (Array.isArray(left) && Array.isArray(right)) {
            system[key] = [...left, ...right];
          }
        }
        result.system = system;
      }
      return result;
    }
    /** Union two name-keyed sections, refusing a name that appears in both. */
    mergeMaps(left, right, label) {
      if (!isPlainObject(left) || !isPlainObject(right))
        return void 0;
      for (const name of Object.keys(right)) {
        if (name in left) {
          throw new ParseError(`"${label}.${name}" is declared in two different files. Each name may only be defined once across the whole model.`);
        }
      }
      return { ...left, ...right };
    }
    // =========================================================================
    // PARSING
    // =========================================================================
    parseProject(raw) {
      const projectRaw = raw.project;
      if (!projectRaw) {
        throw new ParseError('Missing "project" section');
      }
      const legacy = raw.system !== void 0;
      if (legacy) {
        this.warnings.push('This model uses the retired "system:" block. Split it into the top-level domains (target, hardware, parameters, events, machine, actions) - see PLAN.md. Support will be removed in the next release.');
      }
      const system = legacy ? this.parseSystem(raw.system) : this.parseDomains(raw);
      const schemaVersion = this.parseSchemaVersion(raw.pulseir);
      const project = {
        name: projectRaw.name || "unnamed",
        version: projectRaw.version || "0.1.0",
        description: projectRaw.description,
        schemaVersion,
        target: this.parseTarget(raw.target),
        system
      };
      if (!project.target?.board) {
        this.warnings.push("No target board declared. Pin validation is disabled and board-specific code hints will show all options rather than just yours. Add one:\n  target:\n    board: esp32   # or uno, mega, nano, rp2040, esp8266 ...");
      }
      const conflicts = findPinConflicts(project);
      const fatal = conflicts.filter((c) => !(legacy && c.busDeviceOnly));
      const ambiguous = conflicts.filter((c) => legacy && c.busDeviceOnly);
      for (const conflict of ambiguous) {
        this.warnings.push(`${describePinConflict(conflict)}
  Reported as a warning because this model uses the retired schema, which cannot declare that a device sits on a bus.`);
      }
      if (fatal.length > 0) {
        throw new ParseError(fatal.map(describePinConflict).join("\n\n"));
      }
      return project;
    }
    parseSchemaVersion(raw) {
      if (raw === void 0 || raw === null)
        return void 0;
      const ver = typeof raw === "number" ? Math.floor(raw) : typeof raw === "string" ? parseInt(raw, 10) : NaN;
      if (isNaN(ver) || ver < 1) {
        throw new ParseError(`"pulseir" must be a positive schema version number (e.g. pulseir: "1"), got ${JSON.stringify(raw)}`);
      }
      if (ver > SCHEMA_VERSION) {
        this.warnings.push(`This model declares pulseir: "${ver}" but this toolchain only understands schema version ${SCHEMA_VERSION}. Some fields may be ignored. Update the toolchain, or remove the version declaration to silence this warning.`);
      }
      return ver;
    }
    parseTarget(raw) {
      if (raw === void 0 || raw === null)
        return void 0;
      if (typeof raw === "string")
        return { board: raw };
      const obj = raw;
      return {
        board: obj.board,
        verbose: obj.verbose === void 0 ? void 0 : Boolean(obj.verbose),
        description: obj.description
      };
    }
    // =========================================================================
    // DOMAIN SCHEMA (current)
    // =========================================================================
    /**
     * Read the domain-per-section shape:
     *
     *   target:      what it is built for
     *   hardware:    buses and devices
     *   parameters:  tunable configuration
     *   events:      what the system reacts to
     *   machine:     states and transitions
     *   actions:     catalogue of named side effects
     *   libraries:   third-party code
     *
     * Sections carrying identity (devices, parameters, events, actions, states)
     * are maps keyed by name, so a duplicate is impossible to write. Ordered
     * rules - transitions - stay lists, because order decides which one shadows
     * another.
     */
    parseDomains(raw) {
      this.resetValidationState();
      const machine = raw.machine ?? {};
      const hardware = raw.hardware ?? {};
      const events = this.parseEventMap(raw.events);
      events.forEach((e) => this.eventNames.add(e.name));
      const states = this.parseStateMap(machine.states);
      this.indexStateNames(states);
      const actionCatalogue = this.parseActionCatalogue(raw.actions);
      actionCatalogue.forEach((_, name) => this.actionNames.add(name));
      const transitions = this.parseTransitionList(machine.transitions, actionCatalogue);
      const tasks = this.parseTaskMap(raw.tasks, actionCatalogue);
      const commands = this.parseCommands(raw.commands, actionCatalogue);
      const resources = this.parseBusMap(hardware.buses);
      const components = this.parseDeviceMap(hardware.devices);
      const parameters = this.parseParameterMap(raw.parameters);
      const libraries = this.parseLibraries(this.asList(raw.libraries, "library"));
      this.assertUniqueNames(events, "event");
      this.assertUniqueNames(components, "component");
      this.assertUniqueNames(resources, "resource");
      this.assertUniqueNames(parameters, "parameter");
      this.assertUniqueNames(libraries, "library");
      this.assertLibraryRefs(resources, libraries);
      this.assertBusRefs(components, resources);
      this.assertTimedTransitions(transitions, parameters || []);
      this.assertTaskIntervals(tasks, parameters || []);
      this.assertLogRefs(tasks, commands, parameters || [], components || []);
      this.assertUsable(states, tasks, commands);
      const busNames = new Set((resources || []).map((r) => r.name));
      for (const device of components || []) {
        if (busNames.has(device.name)) {
          throw new ParseError(`"${device.name}" is declared as both a bus and a device. Names are shared between them, so pick one.`);
        }
      }
      return {
        name: raw.name || raw.project?.name || "unnamed",
        description: machine.description,
        events,
        states,
        transitions,
        tasks,
        commands,
        components,
        resources,
        parameters,
        libraries
      };
    }
    /** Accept `{ name: {...} }` and turn it into `[{ name, ... }]`. */
    mapEntries(raw, section) {
      if (raw === void 0 || raw === null)
        return [];
      if (Array.isArray(raw)) {
        throw new ParseError(`"${section}" is a list, but this schema keys it by name:
  ${section}:
    my_${section.replace(/s$/, "")}:
      ...`);
      }
      if (typeof raw !== "object") {
        throw new ParseError(`"${section}" must be a mapping of name to definition`);
      }
      return Object.entries(raw).map(([name, value]) => {
        if (!name.trim())
          throw new ParseError(`"${section}" has an entry with an empty name`);
        if (value === null || value === void 0)
          return [name, {}];
        if (typeof value !== "object" || Array.isArray(value)) {
          throw new ParseError(`"${section}.${name}" must be a mapping`);
        }
        return [name, value];
      });
    }
    asList(raw, section) {
      if (raw === void 0 || raw === null)
        return void 0;
      if (!Array.isArray(raw))
        throw new ParseError(`"${section}" must be a list`);
      return raw;
    }
    parseEventMap(raw) {
      return this.mapEntries(raw, "events").map(([name, def]) => ({
        name,
        source: def.source || "external",
        description: def.description,
        payload: def.payload
      }));
    }
    parseParameterMap(raw) {
      const entries = this.mapEntries(raw, "parameters");
      if (entries.length === 0)
        return void 0;
      return entries.map(([name, def]) => {
        const range = def.range;
        if (range !== void 0 && (!Array.isArray(range) || range.length !== 2)) {
          throw new ParseError(`Parameter "${name}" has a "range" that is not [min, max]`);
        }
        return {
          name,
          type: def.type,
          default: def.default,
          min: range ? range[0] : def.min,
          max: range ? range[1] : def.max,
          unit: def.unit,
          description: def.description
        };
      });
    }
    /**
     * States nest by containment, so a composite is just a state that has
     * `states:` under it. The type is inferred from that; declaring it is
     * optional and only useful for future kinds.
     */
    parseStateMap(raw) {
      return this.mapEntries(raw, "states").map(([name, def]) => {
        const children = this.parseStateMap(def.states);
        const declared = def.type;
        if (children.length === 0) {
          if (def.initial !== void 0) {
            throw new ParseError(`State "${name}" declares "initial" but has no nested states`);
          }
          return { name, type: declared || "simple", description: def.description };
        }
        const initial = def.initial ?? children[0].name;
        if (!children.some((c) => c.name === initial)) {
          throw new ParseError(`State "${name}" declares initial "${initial}", which is not one of its states (${children.map((c) => c.name).join(", ")})`);
        }
        return {
          name,
          type: declared || "composite",
          description: def.description,
          initial,
          regions: [{ initial, states: children }]
        };
      });
    }
    /** Catalogue of named actions, so a transition's `do:` can carry params. */
    parseActionCatalogue(raw) {
      const catalogue = /* @__PURE__ */ new Map();
      for (const [name, def] of this.mapEntries(raw, "actions")) {
        catalogue.set(name, {
          name,
          type: def.type || "driver",
          driver: def.driver || name,
          params: def.params
        });
      }
      return catalogue;
    }
    parseTransitionList(raw, catalogue) {
      const list = this.asList(raw, "machine.transitions");
      if (!list)
        return [];
      return list.map((entry, index) => {
        const from = entry.from;
        const on = entry.on;
        const to = entry.to;
        const after = this.parseAfter(entry.after, index);
        if (on !== void 0 && after !== void 0) {
          throw new ParseError(`Transition ${index + 1} has both "on" and "after". A transition fires either when an event arrives or when a duration elapses, not both.`);
        }
        if (on === void 0 && after === void 0) {
          throw new ParseError(`Transition ${index + 1} has neither "on" nor "after", so nothing would ever make it fire. Use "on: SOME_EVENT" or "after: 5000".`);
        }
        const trigger = on !== void 0 ? [["from", from], ["on", on], ["to", to]] : [["from", from], ["to", to]];
        for (const [key, value] of trigger) {
          if (typeof value !== "string" || !value.trim()) {
            throw new ParseError(`Transition ${index + 1} is missing "${key}"`);
          }
        }
        if (on !== void 0 && on !== "*" && !this.eventNames.has(on)) {
          throw new ParseError(`Transition ${index + 1} reacts to unknown event "${on}"`);
        }
        if (from !== "*" && !this.hasState(from)) {
          throw new ParseError(`Transition "from" state "${from}" ${this.describeBadRef(from)}`);
        }
        if (to === "*") {
          throw new ParseError('Transition "to" cannot be the wildcard "*"');
        }
        if (!this.hasState(to)) {
          throw new ParseError(`Transition "to" state "${to}" ${this.describeBadRef(to)}`);
        }
        if (after !== void 0 && from === "*") {
          throw new ParseError(`Transition ${index + 1} uses "after" from "*". A duration is measured from entering one state, so a timed transition needs a real "from".`);
        }
        if (after !== void 0 && from === to) {
          throw new ParseError(`Transition ${index + 1} uses "after" to re-enter "${to}". A timer starts when a state is entered, and this never leaves it, so the timer would not restart and the transition would fire on every pass.
For a repeating cycle, alternate between two states.`);
        }
        return {
          source: from,
          target: to,
          event: on,
          after,
          guard: entry.guard !== void 0 && entry.guard !== null ? this.parseGuard(entry.guard) : void 0,
          actions: this.resolveActions(entry.do, catalogue, index),
          description: entry.description
        };
      });
    }
    /**
     * `tasks:` - work that repeats on an interval.
     *
     *   tasks:
     *     blink: { every: blink_ms, do: toggle_led }
     *
     * Not every board is a state machine. A blink or a heartbeat is scheduling,
     * which is configuration, so it belongs in the model rather than being
     * dressed up as a two-state HSM.
     */
    parseTaskMap(raw, catalogue) {
      return this.mapEntries(raw, "tasks").map(([name, def], index) => {
        if (def.every === void 0) {
          throw new ParseError(`Task "${name}" has no "every". A task runs on an interval:
  tasks:
    ${name}: { every: 500, do: some_action }`);
        }
        const actions = this.resolveActions(def.do, catalogue, index);
        const log = this.parseLog(def.log, `Task "${name}"`);
        if (!actions?.length && log === void 0) {
          throw new ParseError(`Task "${name}" has neither "do" nor "log", so it would do nothing every ${def.every}ms`);
        }
        return {
          name,
          every: this.parseInterval(def.every, `Task "${name}"`),
          actions: actions ?? [],
          log,
          description: def.description
        };
      });
    }
    /**
     * `commands:` - a line of text in, a named action out.
     *
     *   commands:
     *     source: console
     *     map:
     *       on:  led_on
     *       off: led_off
     *
     * A dispatch table is data. Pulling arguments out of a command line is not,
     * and stays in the action you write.
     */
    parseCommands(raw, catalogue) {
      if (raw === void 0 || raw === null)
        return void 0;
      if (!isPlainObject(raw)) {
        throw new ParseError("commands: must be a mapping:\n  commands:\n    source: console\n    map:\n      on: led_on");
      }
      if (!isPlainObject(raw.map)) {
        throw new ParseError('commands: declares no "map", so no command would ever be recognised');
      }
      const seen = /* @__PURE__ */ new Set();
      const commands = Object.entries(raw.map).map(([match, def], index) => {
        const text = match.trim();
        if (!text)
          throw new ParseError("A command cannot be an empty string");
        if (seen.has(text))
          throw new ParseError(`Command "${text}" is declared twice`);
        seen.add(text);
        const long = isPlainObject(def) ? def : null;
        const event = long?.event;
        if (event !== void 0 && !this.eventNames.has(event)) {
          throw new ParseError(`Command "${text}" raises unknown event "${event}"`);
        }
        const actions = this.resolveActions(long ? long.do : def, catalogue, index);
        const log = this.parseLog(long?.log, `Command "${text}"`);
        if (!actions?.length && event === void 0 && log === void 0) {
          throw new ParseError(`Command "${text}" has no "do", "event" or "log", so receiving it would do nothing`);
        }
        return { match: text, actions, event, log, description: long?.description };
      });
      return {
        source: raw.source,
        commands,
        reportUnknown: raw.report_unknown === void 0 ? true : Boolean(raw.report_unknown)
      };
    }
    /** `log: "temp={temp}C"` - checked for shape here, for names later. */
    parseLog(raw, where) {
      if (raw === void 0 || raw === null)
        return void 0;
      if (typeof raw !== "string") {
        throw new ParseError(`${where} has a "log" of type ${typeof raw}; it must be a string`);
      }
      try {
        parseTemplate(raw);
      } catch (error) {
        throw new ParseError(`${where}: ${error instanceof TemplateError ? error.message : String(error)}`);
      }
      return raw;
    }
    /** Milliseconds: a positive literal, or the name of an int parameter. */
    parseInterval(raw, where) {
      if (typeof raw === "number") {
        if (!Number.isInteger(raw) || raw <= 0) {
          throw new ParseError(`${where} has an interval of ${raw}. It must be a positive whole number of milliseconds, or the name of an int parameter.`);
        }
        return raw;
      }
      if (typeof raw === "string" && raw.trim())
        return raw.trim();
      throw new ParseError(`${where} has an interval of type ${typeof raw}. Use a number of milliseconds, or the name of an int parameter.`);
    }
    /**
     * `after: 5000` or `after: green_ms`.
     *
     * Naming a parameter keeps the duration tunable at runtime; the generated
     * code reads it every tick rather than capturing it at boot. The parameter
     * itself is checked once they have all been parsed.
     */
    parseAfter(raw, index) {
      if (raw === void 0 || raw === null)
        return void 0;
      if (typeof raw === "number") {
        if (!Number.isInteger(raw) || raw <= 0) {
          throw new ParseError(`Transition ${index + 1} has after: ${raw}. It must be a positive whole number of milliseconds, or the name of an int parameter.`);
        }
        return raw;
      }
      if (typeof raw === "string" && raw.trim())
        return raw.trim();
      throw new ParseError(`Transition ${index + 1} has an "after" of type ${typeof raw}. Use a number of milliseconds, or the name of an int parameter.`);
    }
    /**
     * `do:` takes one name or a list of them. When an `actions:` catalogue
     * exists it is authoritative, so a typo is an error rather than a silently
     * generated stub for a function nobody will implement.
     */
    resolveActions(raw, catalogue, index) {
      if (raw === void 0 || raw === null)
        return void 0;
      const names = Array.isArray(raw) ? raw : [raw];
      const strict = catalogue.size > 0;
      return names.map((entry) => {
        if (typeof entry !== "string" || !entry.trim()) {
          throw new ParseError(`Transition ${index + 1} has a "do" entry that is not an action name`);
        }
        const declared = catalogue.get(entry);
        if (declared)
          return { ...declared };
        if (strict) {
          throw new ParseError(`Transition ${index + 1} does "${entry}", which is not in the actions catalogue. Declared: ${[...catalogue.keys()].join(", ") || "none"}.`);
        }
        return { name: entry, type: "driver", driver: entry };
      });
    }
    parseBusMap(raw) {
      const entries = this.mapEntries(raw, "buses");
      if (entries.length === 0)
        return void 0;
      return entries.map(([name, def]) => {
        const iface = def.interface;
        if (!iface)
          throw new ParseError(`Bus "${name}" has no "interface"`);
        this.assertKnownInterface(name, iface);
        const { interface: _i, description, library, ...binding } = def;
        return {
          name,
          interface: iface,
          binding: Object.keys(binding).length > 0 ? binding : void 0,
          library,
          description
        };
      });
    }
    parseDeviceMap(raw) {
      const entries = this.mapEntries(raw, "devices");
      if (entries.length === 0)
        return void 0;
      return entries.map(([name, def]) => {
        const type2 = def.type;
        if (!type2) {
          throw new ParseError(`Device "${name}" has no "type"`);
        }
        const builtin = BUILTIN_DEVICE_TYPES[type2];
        const declaredClass = def.class;
        if (!builtin && !declaredClass) {
          throw new ParseError(`Device "${name}" has type "${type2}", which is not built in, so it needs an explicit "class" (sensor, actuator or service). Guessing would risk publishing an actuator as if it were a reading.
Built-in types: ${Object.keys(BUILTIN_DEVICE_TYPES).join(", ")}.`);
        }
        const { type: _t, class: _c, bus, description, ...config } = def;
        return {
          name,
          class: declaredClass || builtin.class,
          driver: def.driver || builtin?.driver || type2,
          type: type2,
          bus,
          config: Object.keys(config).length > 0 ? config : void 0,
          description
        };
      });
    }
    assertKnownInterface(name, iface) {
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
      if (!known.includes(iface)) {
        throw new ParseError(`"${name}" has unknown interface "${iface}". Expected one of: ${known.join(", ")}.`);
      }
    }
    assertLibraryRefs(resources, libraries) {
      const names = new Set((libraries || []).map((l) => l.name));
      for (const resource of resources || []) {
        if (resource.library && !names.has(resource.library)) {
          throw new ParseError(`"${resource.name}" needs library "${resource.library}", which is not declared`);
        }
      }
    }
    assertBusRefs(components, resources) {
      const names = new Set((resources || []).map((r) => r.name));
      for (const component of components || []) {
        if (component.bus && !names.has(component.bus)) {
          throw new ParseError(`Device "${component.name}" sits on bus "${component.bus}", which is not declared. Declared buses: ${[...names].join(", ") || "none"}.`);
        }
      }
    }
    resetValidationState() {
      this.eventNames.clear();
      this.stateNames.clear();
      this.actionNames.clear();
      this.statePaths.clear();
      this.statesByLeafName.clear();
    }
    parseSystem(raw) {
      this.resetValidationState();
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
      for (const item2 of items) {
        if (seen.has(item2.name)) {
          throw new ParseError(`Duplicate ${kind} "${item2.name}" (check whether two included files both declare it)`);
        }
        seen.add(item2.name);
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
            name: a,
            type: "driver",
            driver: a
          };
        }
        return {
          name: a.name || a.driver,
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
     * Every `{name}` in a log template must name something the model declared.
     *
     * Checked here rather than in the backend, so a typo is a model error with
     * the alternatives listed - not a C++ compile error in generated code.
     */
    assertLogRefs(tasks, commands, parameters, components) {
      const known = /* @__PURE__ */ new Map();
      for (const parameter of parameters)
        known.set(parameter.name, "parameter");
      for (const device of components) {
        if (device.class === "sensor")
          known.set(device.name, "sensor");
      }
      const check = (template, where) => {
        if (template === void 0)
          return;
        for (const name of templateRefs(parseTemplate(template))) {
          if (known.has(name))
            continue;
          const options = [...known.keys()];
          throw new ParseError(`${where} logs "{${name}}", which is not a declared parameter or sensor. ` + (options.length ? `Available: ${options.join(", ")}.` : "The model declares no parameters and no sensors."));
        }
      };
      for (const task of tasks)
        check(task.log, `Task "${task.name}"`);
      for (const command of commands?.commands || []) {
        check(command.log, `Command "${command.match}"`);
      }
    }
    /** A task interval naming a parameter must name a real int one. */
    assertTaskIntervals(tasks, parameters) {
      const byName = new Map(parameters.map((p) => [p.name, p]));
      for (const task of tasks) {
        if (typeof task.every !== "string")
          continue;
        const parameter = byName.get(task.every);
        if (!parameter) {
          const known = [...byName.keys()];
          throw new ParseError(`Task "${task.name}" runs every "${task.every}", which is not a declared parameter. ` + (known.length ? `Known parameters: ${known.join(", ")}.` : "No parameters are declared."));
        }
        if (parameter.type !== "int") {
          throw new ParseError(`Task "${task.name}" runs every "${task.every}", which is declared as ${parameter.type}. An interval in milliseconds must be an int.`);
        }
      }
    }
    /**
     * A model has to *do* something.
     *
     * A state machine is one way, but not the only one - PulseHSM is one tenant
     * of this IR, so `tasks:` or `commands:` alone is a complete project. What is
     * not allowed is a model with none of the three, which would generate a
     * sketch that runs an empty loop forever.
     */
    assertUsable(states, tasks, commands) {
      if (states.length > 0 || tasks.length > 0 || commands)
        return;
      const empty = new ParseError("The model does nothing. Give it at least one of:\n  machine:   states and transitions\n  tasks:     work that repeats on an interval\n  commands:  actions to run when a command arrives");
      empty.kind = "empty-model";
      throw empty;
    }
    /**
     * Check every `after:` that names a parameter, once they have all been read.
     *
     * It has to name a real parameter of an integer type, or the generated code
     * would not compile - and it would fail inside generated code the student
     * did not write, which is the worst possible place to find out.
     */
    assertTimedTransitions(transitions, parameters) {
      const byName = new Map(parameters.map((p) => [p.name, p]));
      transitions.forEach((transition, index) => {
        if (typeof transition.after !== "string")
          return;
        const where = `Transition ${index + 1} (${transition.source} \u2192 ${transition.target})`;
        const parameter = byName.get(transition.after);
        if (!parameter) {
          const known = [...byName.keys()];
          throw new ParseError(`${where} waits for "${transition.after}", which is not a declared parameter. ` + (known.length ? `Known parameters: ${known.join(", ")}.` : "No parameters are declared.") + ' Use a number of milliseconds, or declare it under "parameters".');
        }
        if (parameter.type !== "int") {
          throw new ParseError(`${where} waits for "${transition.after}", which is declared as ${parameter.type}. A duration in milliseconds must be an int.`);
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

  // dist/src/parser/resolver.js
  var MemoryResolver = class {
    constructor(files) {
      this.files = files;
    }
    resolve(ref, from) {
      if (ref.startsWith("/") || !from)
        return normalize(ref);
      const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
      return normalize(dir ? `${dir}/${ref}` : ref);
    }
    read(id) {
      const content = this.files[id];
      if (content === void 0) {
        throw new Error(`no such file "${id}"`);
      }
      return content;
    }
  };
  function normalize(input) {
    const absolute = input.startsWith("/");
    const parts = [];
    for (const segment of input.split("/")) {
      if (!segment || segment === ".")
        continue;
      if (segment === "..") {
        if (parts.length && parts[parts.length - 1] !== "..")
          parts.pop();
        else if (!absolute)
          parts.push("..");
        continue;
      }
      parts.push(segment);
    }
    return (absolute ? "/" : "") + parts.join("/");
  }

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
        case "pwm": {
          if (has("pin") && has("channel")) {
            const freq = has("frequency") ? ref("frequency") : "5000";
            const resolution = has("resolution") ? ref("resolution") : "8";
            out.init.push("#ifdef ARDUINO_ARCH_ESP32", "#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3", `  ledcAttach(${ref("pin")}, ${freq}, ${resolution});`, "#else", `  ledcSetup(${ref("channel")}, ${freq}, ${resolution});`, `  ledcAttachPin(${ref("pin")}, ${ref("channel")});`, "#endif", "#endif");
            out.todos.push(`${resource.name}: write duty with ledcWrite(${ref("pin")}, duty) on core 3.x, or ledcWrite(${ref("channel")}, duty) before it`);
          } else if (has("pin")) {
            out.init.push(`pinMode(${ref("pin")}, OUTPUT);`);
          }
          break;
        }
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
  var DEVICE_INTERFACE = {
    digital_output: { interface: "gpio", mode: "OUTPUT" },
    digital_input: { interface: "gpio", mode: "INPUT" },
    pwm_output: { interface: "pwm" },
    analog_input: { interface: "adc" }
  };
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
      this.timedBySource = /* @__PURE__ */ new Map();
      this.interfaces = new InterfaceBackend();
      this.emissions = /* @__PURE__ */ new Map();
      this.libraries = /* @__PURE__ */ new Map();
    }
    /**
     * True when the model declares a state machine.
     *
     * PulseHSM is one tenant of this IR, not its foundation: a blink, or a board
     * that answers commands over the serial monitor, is a complete project with
     * no states at all. When this is false nothing about the runtime is emitted -
     * no include, no sizing header, no fsm - and the sketch is plain Arduino.
     */
    get hasMachine() {
      return this.states.length > 0;
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
      this.assertConsoleForLogs();
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
        this.generateTimeouts(),
        this.generateTasks(),
        this.generateCommands(),
        this.generateSetupFunction(),
        this.generateLoopFunction(),
        this.generateGuardImplementations(),
        this.generateActionImplementations()
      ].join("\n\n") + "\n";
    }
    /**
     * Generate the project as separate files, so regenerating never touches code
     * you wrote.
     *
     * Everything derived from the model is rewritten every time. Guard and action
     * bodies are *scaffolds*: emitted once if absent, and never again. That split
     * is the whole point - with a single self-contained sketch, regenerating
     * silently destroys every implementation you filled in.
     */
    generateFiles(project) {
      this.reset();
      this.project = project;
      this.indexStates();
      this.indexGuards();
      this.indexActions();
      this.indexTransitions();
      this.indexInterfaces();
      this.assertConsoleForLogs();
      const base = this.sanitize(project.name);
      const headerName = `${base}_generated.h`;
      const guardName = "src/guards.cpp";
      const actionName = "src/actions.cpp";
      return {
        // Only a project with a state machine needs the runtime, the header that
        // sizes it, or a place to put guards - guards live on transitions.
        needsRuntime: this.hasMachine,
        generated: [
          ...this.hasMachine ? [{ path: "PulseHSM_config.h", contents: this.generateConfigHeader() }] : [],
          { path: headerName, contents: this.composeHeader(headerName) },
          { path: `${base}.ino`, contents: this.composeSketch(headerName) }
        ],
        scaffolds: [
          ...this.hasMachine ? [{ path: guardName, contents: this.composeGuardFile(headerName) }] : [],
          { path: actionName, contents: this.composeActionFile(headerName) }
        ]
      };
    }
    /** Declarations: types, macros and prototypes that every file shares. */
    composeHeader(headerName) {
      const guard = `PULSEIR_${this.sanitizeUpper(this.project.name)}_GENERATED_H`;
      return [
        this.generateHeader(),
        `#ifndef ${guard}
#define ${guard}`,
        this.generateIncludes(),
        this.declInterfaces(),
        this.declEventEnum(),
        this.declParameterStruct(),
        this.declSensorStruct(),
        this.declContextStruct(),
        this.hasMachine ? this.machineGlobals(true) : "",
        `// Instances the sketch defines.
extern SystemParameters systemParameters;
extern SystemSensors systemSensors;
extern SystemContext systemContext;

// The Arduino IDE auto-prototypes these for .ino files, but a .cpp in src/
// needs them declared.
void setup();
void loop();
void setupInterfaces();${this.declInterfaceGlobals()}`,
        this.generateGuardDeclarations(),
        this.generateActionDeclarations(),
        `#endif  // ${guard}`
      ].join("\n\n") + "\n";
    }
    /** Definitions the model owns. Rewritten on every generate. */
    composeSketch(headerName) {
      return [
        `/**
 * PulseIR Generated Code - DO NOT EDIT.
 *
 * Regenerated from the model every time. Your guards and actions live in
 * src/, which this file never overwrites.
 */

#include "${headerName}"`,
        this.defEventNames(),
        this.defParameterInstance(),
        "SystemSensors systemSensors = {};",
        "SystemContext systemContext;",
        this.hasMachine ? this.machineGlobals(false).replace(/^\/\/ =+\n\/\/ STATE MACHINE\n\/\/ =+\n\n/m, "") : "",
        this.defInterfaces().trimStart(),
        this.generateEventHandlers(),
        this.generateTimeouts(),
        this.generateTasks(),
        this.generateCommands(),
        this.generateSetupFunction(),
        this.generateLoopFunction()
      ].join("\n\n") + "\n";
    }
    composeGuardFile(headerName) {
      return `/**
 * Guards - YOUR CODE. Safe to edit; regenerating never overwrites this file.
 *
 * A guard is a pure check: return true to allow the transition, false to block
 * it. Blocking does not consume the event, so an enclosing state still gets a
 * chance to handle it.
 *
 * Delete this file and regenerate to get fresh stubs.
 */

#include "${headerName}"

${this.generateGuardImplementations()}
`;
    }
    composeActionFile(headerName) {
      return `/**
 * Actions - YOUR CODE. Safe to edit; regenerating never overwrites this file.
 *
 * Actions run before the state changes, so ctx->currentState is still the state
 * being left. Everything you need is on ctx: parameters, sensor readings, the
 * current and previous state, and the event payload.
 *
 * Delete this file and regenerate to get fresh stubs.
 */

#include "${headerName}"

${this.generateActionImplementations()}
`;
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
      this.timedBySource = /* @__PURE__ */ new Map();
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
        this.addEmission(resource.name, this.interfaces.emit(resource, this.sanitizeUpper(resource.name)));
      }
      for (const device of this.project.system.components || []) {
        const mapping = DEVICE_INTERFACE[device.type || ""];
        if (!mapping)
          continue;
        const binding = { ...device.config || {} };
        if (mapping.mode && binding.mode === void 0)
          binding.mode = mapping.mode;
        this.addEmission(device.name, this.interfaces.emit({
          name: device.name,
          interface: mapping.interface,
          binding,
          description: device.description
        }, this.sanitizeUpper(device.name)));
      }
      for (const library of this.interfaces.declared(this.project.system.libraries)) {
        this.libraries.set(library.name, library);
      }
    }
    addEmission(name, emission) {
      this.emissions.set(name, emission);
      for (const library of emission.libraries) {
        if (!this.libraries.has(library.name))
          this.libraries.set(library.name, library);
      }
    }
    // =========================================================================
    // HEADER
    // =========================================================================
    /**
     * How big the runtime's tables have to be for this model.
     *
     * These decide the layout of the PulseHSM class, so every translation unit
     * has to see the same values - see generateConfigHeader().
     */
    sizing() {
      return {
        maxStates: this.states.length + 2,
        // + headroom for growth
        maxEvents: this.nextPowerOfTwo(Math.max(8, this.project.system.events.length)),
        levels: Math.max(1, ...this.states.map((s) => s.depth + 1))
      };
    }
    /**
     * PulseHSM_config.h - the sizing macros, in a file the runtime itself reads.
     *
     * A `#define` in the sketch is not enough. PulseHSM.cpp is its own
     * translation unit and never sees it, so it keeps the defaults: the sketch
     * allocates a table for N states while the runtime is compiled believing
     * there are 8. Small models get away with it; the ninth state is silently
     * refused and the machine is quietly wrong. PulseHSM.h includes this file,
     * so every translation unit agrees.
     *
     * Public because `--output` needs it too: a single-file sketch still links
     * against a separately compiled PulseHSM.cpp. Call it after generate().
     */
    generateConfigHeader() {
      const { maxStates, maxEvents, levels } = this.sizing();
      return `/**
 * PulseHSM sizing for ${this.project.name} - GENERATED, DO NOT EDIT.
 *
 * PulseHSM.h includes this file, so the runtime and the sketch are compiled
 * against the same table sizes. Keep it next to PulseHSM.h; deleting it drops
 * the runtime back to its defaults, which are smaller than this model needs.
 */
#ifndef PULSEHSM_CONFIG_H
#define PULSEHSM_CONFIG_H

#define PULSEHSM_MAX_STATES  ${maxStates}   // ${this.states.length} states + headroom
#define PULSEHSM_MAX_EVENTS  ${maxEvents}   // ring buffer, must be a power of two
#define PULSEHSM_MAX_DEPTH   ${levels}   // deepest nesting, including the leaf

#endif  // PULSEHSM_CONFIG_H
`;
    }
    generateHeader() {
      const { name, version } = this.project;
      const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const preamble = `/**
 * PulseIR Generated Code
 *
 * Project: ${name}
 * Version: ${version}
 * Generated: ${date}
 *
 * This file was auto-generated from a PulseIR model.
 * DO NOT EDIT MANUALLY - regenerate from source instead.
 *
 * Runtime: none. This model declares no state machine, so the sketch below is
 * plain Arduino and needs no library beyond the core.
 *
 * Action signatures follow FUNCTION_CONTRACT.md:
 *   void action_<name>(SystemContext* ctx)
 */`;
      if (!this.hasMachine) {
        return `${preamble}

#include <Arduino.h>`;
      }
      const { maxStates, maxEvents, levels } = this.sizing();
      return `/**
 * PulseIR Generated Code
 *
 * Project: ${name}
 * Version: ${version}
 * Generated: ${date}
 *
 * This file was auto-generated from a PulseIR model.
 * DO NOT EDIT MANUALLY - regenerate from source instead.
 *
 * Runtime: PulseHSM (this model declares a state machine).
 *
 * Guard/action signatures follow FUNCTION_CONTRACT.md:
 *   bool guard_<name>(const SystemContext* ctx)
 *   void action_<name>(SystemContext* ctx)
 */

// Sized from the model, and repeated in PulseHSM_config.h so that PulseHSM.cpp
// - a separate translation unit that never sees this file - is compiled
// against the same table sizes. Defining them only here would leave the
// runtime on its defaults, and states past the eighth would be silently
// dropped. Generate with --outdir to get that file written for you.
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
      return `${this.declInterfaces()}
${this.defInterfaces()}`;
    }
    /** Pin and setting macros. Drivers reference these, so they go in the header. */
    /** Buses first, then self-initialising devices - the order they set up in. */
    initialisedResources() {
      const buses = (this.project.system.resources || []).map((r) => ({
        name: r.name,
        interface: String(r.interface),
        description: r.description
      }));
      const devices = (this.project.system.components || []).filter((d) => DEVICE_INTERFACE[d.type || ""]).map((d) => ({
        name: d.name,
        interface: DEVICE_INTERFACE[d.type].interface,
        description: d.description
      }));
      return [...buses, ...devices];
    }
    declInterfaces() {
      const resources = this.initialisedResources();
      if (resources.length === 0) {
        return `// ============================================================================
// INTERFACES
// ============================================================================

// No resources declared.`;
      }
      const blocks = [];
      const todos = [];
      for (const resource of resources) {
        const emission = this.emissions.get(resource.name);
        if (!emission)
          continue;
        const heading2 = `// ${resource.name} (${resource.interface})` + (resource.description ? ` - ${resource.description}` : "");
        if (emission.defines.length > 0) {
          blocks.push([heading2, ...emission.defines].join("\n"));
        } else {
          blocks.push(heading2);
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
${blocks.join("\n\n")}`;
    }
    /** Client objects and the init sequence: definitions the sketch owns. */
    defInterfaces() {
      const resources = this.initialisedResources();
      if (resources.length === 0)
        return "\nvoid setupInterfaces() {}";
      const globals = [];
      const body = [];
      for (const resource of resources) {
        const emission = this.emissions.get(resource.name);
        if (!emission)
          continue;
        globals.push(...emission.globals);
        if (emission.init.length > 0) {
          body.push(`  // ${resource.name}`);
          body.push(...emission.init.map((line) => line.startsWith("#") ? line : `  ${line}`));
          body.push("");
        }
      }
      return `${globals.length > 0 ? `
${globals.join("\n")}
` : ""}
void setupInterfaces() {
${body.length > 0 ? body.join("\n").replace(/\n+$/, "") : "  // Nothing to initialise"}
}`;
    }
    /**
     * `extern` forms of the interface objects, so a driver in src/ can reach the
     * OneWire bus or MQTT client that the sketch defines.
     */
    declInterfaceGlobals() {
      const externs = [];
      for (const emission of this.emissions.values()) {
        for (const line of emission.globals) {
          if (line.trimStart().startsWith("//"))
            continue;
          const match = /^([A-Za-z_][\w:<>]*)\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?;$/.exec(line.trim());
          if (match)
            externs.push(`extern ${match[1]} ${match[2]};`);
        }
      }
      if (externs.length === 0)
        return "";
      return `
// Objects the sketch defines, available to your drivers.
${externs.join("\n")}`;
    }
    // =========================================================================
    // EVENT ENUM
    // =========================================================================
    generateEventEnum() {
      const events = this.project.system.events;
      if (events.length === 0) {
        if (this.hasMachine) {
          throw new CodegenError("System defines no events; nothing to dispatch");
        }
        return "";
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
    /** The enum alone, plus an extern for the names array the sketch defines. */
    declEventEnum() {
      const [enumPart] = this.generateEventEnum().split("\nconst char* eventNames");
      return `${enumPart}
extern const char* eventNames[];`;
    }
    defEventNames() {
      const names = this.project.system.events.map((e) => this.sanitizeUpper(e.name));
      return `const char* eventNames[] = {
${names.map((n) => `  "${n}"`).join(",\n")}
};`;
    }
    // =========================================================================
    // SYSTEM PARAMETERS (from YAML)
    // =========================================================================
    generateParameterStruct() {
      return `${this.declParameterStruct()}

${this.defParameterInstance()}`;
    }
    declParameterStruct() {
      const parameters = this.project.system.parameters || [];
      if (parameters.length === 0) {
        return `// ============================================================================
// SYSTEM PARAMETERS
// ============================================================================

// No parameters defined in the model.
struct SystemParameters {};`;
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
};`;
    }
    /** The instance, with defaults from the model. Belongs to one translation unit. */
    defParameterInstance() {
      const parameters = this.project.system.parameters || [];
      if (parameters.length === 0)
        return "SystemParameters systemParameters = {};";
      const inits = parameters.map((p, idx) => {
        const comma = idx < parameters.length - 1 ? "," : "";
        return `  ${this.cLiteral(p)}${comma}   // ${this.sanitize(p.name)}`;
      }).join("\n");
      return `// Initialized with the defaults declared in the model.
SystemParameters systemParameters = {
${inits}
};`;
    }
    // =========================================================================
    // SYSTEM SENSORS (user fills in)
    // =========================================================================
    generateSensorStruct() {
      return `${this.declSensorStruct()}

SystemSensors systemSensors = {};`;
    }
    declSensorStruct() {
      const sensors = (this.project.system.components || []).filter((c) => String(c.class) === "sensor");
      const fields = sensors.length > 0 ? sensors.map((c) => `  float ${this.sanitize(c.name)};  // driver: ${c.driver}`).join("\n") : "  // TODO: Add your sensor readings here (e.g. float temperature;)";
      return `// ============================================================================
// SYSTEM SENSORS
// ============================================================================

// One field per sensor component in the model. Populate these from real
// hardware reads in loop() - the generator never reads hardware for you.
struct SystemSensors {
${fields}
};`;
    }
    // =========================================================================
    // SYSTEM CONTEXT
    // =========================================================================
    generateContextStruct() {
      return `${this.declContextStruct()}

SystemContext systemContext;`;
    }
    declContextStruct() {
      return `// ============================================================================
// SYSTEM CONTEXT (see FUNCTION_CONTRACT.md)
// ============================================================================

struct SystemContext {
  int currentState;                    // Current state index (compare with S_*)
  int previousState;                   // Previous state index (-1 before first transition)
  int32_t eventData;                   // Payload of the event being dispatched
  const SystemParameters* parameters;  // Read-only system parameters
  const SystemSensors* sensors;        // Current sensor readings
};`;
    }
    // =========================================================================
    // MACHINE + STATE INDEX GLOBALS
    // =========================================================================
    generateMachineDeclarations() {
      return this.hasMachine ? this.machineGlobals(false) : "";
    }
    /**
     * `extern` when the header declares them for user code to reference;
     * definitions when the sketch owns them.
     */
    machineGlobals(asExtern) {
      const indices = this.states.map((s) => {
        const note = s.path === ROOT_PATH ? "  // synthetic root for wildcard transitions" : `  // ${s.path}`;
        return asExtern ? `extern int ${s.symbol};${note}` : `int ${s.symbol} = -1;${note}`;
      }).join("\n");
      return `// ============================================================================
// STATE MACHINE
// ============================================================================

${asExtern ? "extern PulseHSM fsm;" : "PulseHSM fsm;"}

// State indices returned by addState(). Globals, per the PulseHSM contract.
${indices}`;
    }
    // =========================================================================
    // GUARD / ACTION DECLARATIONS
    // =========================================================================
    generateGuardDeclarations() {
      if (!this.hasMachine)
        return "";
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
      const sync = this.hasMachine ? `// Refresh the context handed to every guard and action.
// Called at the top of each handler so guards see the live machine state.
static void syncContext() {
  systemContext.currentState = fsm.getCurrentState();
  systemContext.previousState = fsm.getPreviousState();
  systemContext.eventData = fsm.getEventData();
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
}` : `// Refresh the context handed to every action. This project has no state
// machine, so the state fields stay at -1 and only the data is refreshed.
static void syncContext() {
  systemContext.currentState = -1;
  systemContext.previousState = -1;
  systemContext.eventData = 0;
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
}`;
      if (handlers.length === 0) {
        if (!this.hasMachine)
          return sync;
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
          const calls = (t.actions || []).map((a) => `        action_${this.sanitize(a.name)}(&systemContext);`).join("\n");
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
        const timed = this.timedBySource.get(flat.index)?.length ? this.timerNames(flat) : null;
        return `  ${flat.symbol} = fsm.addState(
      "${flat.path}",
      ${timed ? `${timed.tick},   // update - checks the "after" timers` : "nullptr,   // update"}
      ${timed ? `${timed.mark},  // entry - starts the "after" clock` : "nullptr,   // entry"}
      nullptr,   // exit
      0,         // timeoutMs - unused; see generateTimeouts()
      -1,        // timeoutNext
      ${handler},  // onEvent
      ${parent});`;
      }).join("\n\n");
      const firstTopLevel = this.states.findIndex((s) => s.parent === -1 && s.path !== ROOT_PATH);
      const rootRelative = this.rootIndex !== -1 ? this.states.findIndex((s) => s.parent === this.rootIndex) : firstTopLevel;
      const startIndex = this.hasMachine ? this.resolveEntry(rootRelative === -1 ? 0 : rootRelative) : -1;
      const machineSetup = !this.hasMachine ? "" : `
  // Register states. Parents are registered before their children.
${registrations}

${this.registrationCheck()}
  // begin() must be given a leaf state.
  fsm.begin(${this.states[startIndex].symbol});
${this.hasConsole && this.isVerbose ? `
  ${this.consoleStream()}.print("Initial state: ");
  ${this.consoleStream()}.println(fsm.getCurrentName());
` : ""}`;
      return `// ============================================================================
// SETUP
// ============================================================================

${componentComments}

void setup() {
  // Buses and peripherals declared as resources. Nothing else is opened: a
  // peripheral the model did not declare has no business appearing here.
  setupInterfaces();

  // Wire up the context handed to every action
  systemContext.parameters = &systemParameters;
  systemContext.sensors = &systemSensors;
${machineSetup}}`;
    }
    // =========================================================================
    // CONSOLE, TASKS AND COMMANDS
    //
    // None of this needs a state machine. A blink is scheduling and a command
    // table is a lookup, so both are configuration, and both belong to projects
    // that never declare a state at all.
    // =========================================================================
    /**
     * The declared UART that owns the console, or undefined.
     *
     * Never invents one. The generator must not open, configure or write to a
     * peripheral the model did not ask for - a model that says nothing about a
     * serial port should produce a sketch that says nothing about one either.
     */
    declaredConsole() {
      const named = this.project.system.commands?.source;
      const buses = this.project.system.resources || [];
      if (named) {
        const found = buses.find((r) => r.name === named);
        if (!found) {
          throw new CodegenError(`commands.source is "${named}", which is not a declared bus. Declare it under hardware.buses.`);
        }
        return found;
      }
      return buses.find((r) => String(r.interface) === "uart" && Number(r.binding?.port ?? 1) === 0);
    }
    /** True when the model declares somewhere for generated code to print. */
    get hasConsole() {
      return this.declaredConsole() !== void 0;
    }
    /** True when action-trace println calls should be emitted. */
    get isVerbose() {
      return this.project.target?.verbose ?? true;
    }
    /** The C expression naming the console stream, e.g. `Serial`. */
    consoleStream() {
      const resource = this.declaredConsole();
      if (!resource)
        return "Serial";
      const port = Number(resource.binding?.port ?? 1);
      return port === 0 ? "Serial" : `Serial${port}`;
    }
    /** `enteredAt`-style globals and the loop body for `tasks:`. */
    generateTasks() {
      const tasks = this.project.system.tasks || [];
      if (tasks.length === 0)
        return "";
      const blocks = tasks.map((task) => {
        const base = this.sanitize(task.name);
        const interval = typeof task.every === "string" ? `(unsigned long)systemParameters.${this.sanitize(task.every)}` : `${task.every}UL`;
        const source2 = typeof task.every === "string" ? `${task.every} (parameter)` : `every ${task.every}ms`;
        const calls = [
          ...task.actions.map((a) => `  action_${this.sanitize(a.name)}(&systemContext);`),
          // After the actions: a task that samples and then reports should print
          // the reading it just took, not the one before it.
          ...task.log ? [this.logLines(task.log, "  ")] : []
        ].join("\n");
        return `// Task "${task.name}" - ${source2}.${task.description ? `
// ${task.description}` : ""}
static unsigned long dueAt_${base} = 0;

static void runTask_${base}() {
  const unsigned long interval = ${interval};
  const unsigned long now = millis();
  if (now - dueAt_${base} < interval) return;

  // Advance the deadline by whole intervals rather than restarting from now.
  // Restarting adds however long the loop took to come round to every period,
  // and that error accumulates: a 100ms blink slowly becomes a 103ms blink.
  dueAt_${base} += interval;

  // Unless we are already a full interval behind - a long blocking call, or
  // the interval was just shortened - in which case give up on catching up
  // and resync, rather than firing repeatedly in a burst.
  if (now - dueAt_${base} >= interval) dueAt_${base} = now;

${calls}
}`;
      });
      return `// ============================================================================
// TASKS
// ============================================================================
//
// Each runs on its own interval, checked every pass of loop(). An interval
// naming a parameter is read every time, so retuning it takes effect at once.
// Subtraction on unsigned long is correct across the millis() rollover.

${blocks.join("\n\n")}`;
    }
    /** The line reader and dispatch table for `commands:`. */
    generateCommands() {
      const set2 = this.project.system.commands;
      if (!set2)
        return "";
      if (!this.hasConsole) {
        throw new CodegenError('commands: needs a console to read from, and the model declares none. Add one:\n  hardware:\n    buses:\n      console: { interface: uart, port: 0, baud: 115200 }\nand name it with "source: console" if you have more than one UART.');
      }
      const stream = this.consoleStream();
      const cases = set2.commands.map((command) => {
        const calls = (command.actions || []).map((a) => `    action_${this.sanitize(a.name)}(&systemContext);`).join("\n");
        const raise = command.event ? `    fsm.sendEvent(EVENT_${this.sanitizeUpper(command.event)});` : "";
        const reply = command.log ? this.logLines(command.log, "    ") : "";
        return `  if (strcmp(line, ${JSON.stringify(command.match)}) == 0) {${command.description ? `
    // ${command.description}` : ""}
${[calls, raise, reply].filter(Boolean).join("\n")}
    return;
  }`;
      });
      const unknown = set2.reportUnknown === false ? "" : `
  ${stream}.print("Unknown command: ");
  ${stream}.println(line);`;
      return `// ============================================================================
// COMMANDS
// ============================================================================
//
// One line of text in, one named action out. Reading the line is generated;
// making sense of anything *inside* it is not - that belongs in your action,
// where a parser can be written and debugged like ordinary C.

// Most Arduino cores pull this in through Arduino.h, but not all of them, and
// the dispatch table below is nothing but strcmp.
#include <string.h>

/** Longest command line accepted. Anything longer is reported and discarded. */
#define COMMAND_BUFFER 64

static char commandLine[COMMAND_BUFFER];
static uint8_t commandLength = 0;
static bool commandOverflow = false;

static void dispatchCommand(const char* line) {
${cases.join("\n")}${unknown}
}

/**
 * Read whatever has arrived, a line at a time.
 *
 * Never blocks: it consumes only what is already buffered, so loop() keeps
 * running whether or not anyone is typing.
 */
static void pollCommands() {
  while (${stream}.available() > 0) {
    const int next = ${stream}.read();

    if (next == '\\n' || next == '\\r') {
      if (commandOverflow) {
        ${stream}.println("Command too long; ignored.");
several_reset
      } else if (commandLength > 0) {
        commandLine[commandLength] = '\\0';
        dispatchCommand(commandLine);
several_reset
      }
      continue;
    }

    if (commandLength >= COMMAND_BUFFER - 1) {
      // Truncating and dispatching would run the wrong command; refuse instead.
      commandOverflow = true;
      continue;
    }
    commandLine[commandLength++] = (char)next;
  }
}`.replace(/several_reset/g, "        commandLength = 0;\n        commandOverflow = false;");
    }
    /**
     * Where a declared param value can be found in C.
     *
     * `params:` is documentation - the generator never turns it into code - but
     * documentation that says `duty: "fan_duty"` leaves the reader to work out
     * that fan_duty is a parameter and what it is called in the generated
     * struct. Naming the C expression closes that gap without writing the body.
     */
    resolveParamHint(value) {
      if (typeof value !== "string")
        return "";
      const parameter = (this.project.system.parameters || []).find((p) => p.name === value);
      if (parameter)
        return `   -> ctx->parameters->${this.sanitize(value)}`;
      const device = (this.project.system.components || []).find((c) => c.name === value);
      if (device) {
        const pin = device.config?.pin !== void 0 ? `${this.sanitizeUpper(value)}_PIN` : null;
        return pin ? `   -> ${pin}` : `   -> device "${value}"`;
      }
      return "";
    }
    /**
     * Board-aware hint for the PWM write call, shown in action stubs when an
     * action references a pwm_output device.
     *
     * The function name differs by board and by ESP32 core version, so this
     * comment is the difference between a student calling the wrong API and
     * getting a compile error they cannot diagnose.
     */
    pwmWriteHint(action) {
      if (action.driver !== "pwm_control")
        return "";
      const deviceName = String(action.params?.device ?? "");
      const device = (this.project.system.components || []).find((c) => c.name === deviceName);
      if (!device)
        return "";
      const pinMacro = `${this.sanitizeUpper(deviceName)}_PIN`;
      const channelMacro = `${this.sanitizeUpper(deviceName)}_CHANNEL`;
      const dutyRaw = action.params?.duty;
      const dutyParam = (this.project.system.parameters || []).find((p) => p.name === String(dutyRaw));
      const dutyExpr = dutyParam ? `ctx->parameters->${this.sanitize(String(dutyRaw))}` : dutyRaw !== void 0 ? String(dutyRaw) : "0";
      const board = (this.project.target?.board ?? "").toLowerCase();
      const isEsp32 = /esp32/.test(board);
      const isAvr = /avr|uno|mega|nano|atmega|leonardo/.test(board);
      const isRp = /rp2040|pico/.test(board);
      if (isEsp32) {
        return "\n  // PWM write (target: " + board + `):
  //   core 3.x: ledcWrite(${pinMacro}, ${dutyExpr});
  //   core 2.x: ledcWrite(${channelMacro}, ${dutyExpr});`;
      }
      if (isAvr || isRp) {
        return "\n  // PWM write (target: " + board + `):
  //   analogWrite(${pinMacro}, ${dutyExpr});`;
      }
      return `
  // PWM write:
  //   ESP32 core 3.x: ledcWrite(${pinMacro}, ${dutyExpr});
  //   ESP32 core 2.x: ledcWrite(${channelMacro}, ${dutyExpr});
  //   AVR / RP2040:   analogWrite(${pinMacro}, ${dutyExpr});`;
    }
    /**
     * A `log:` template as print calls.
     *
     * Emitted verbatim in order - one print per literal, one per value - because
     * printf on an embedded core drags in float formatting and costs several
     * kilobytes of flash for what is a handful of prints.
     */
    logLines(template, indent) {
      const stream = this.consoleStream();
      const segments = parseTemplate(template);
      const out = [];
      for (const segment of segments) {
        if (segment.kind === "text") {
          out.push(`${indent}${stream}.print(${JSON.stringify(segment.value)});`);
          continue;
        }
        out.push(`${indent}${stream}.print(${this.logValue(segment.name)});`);
      }
      out.push(`${indent}${stream}.println();`);
      return out.join("\n");
    }
    /** Where a logged name lives in C. Validated by the parser, so it resolves. */
    logValue(name) {
      const parameter = (this.project.system.parameters || []).find((p) => p.name === name);
      if (parameter)
        return `systemParameters.${this.sanitize(name)}`;
      return `systemSensors.${this.sanitize(name)}`;
    }
    /** Anything in the model that wants to print needs somewhere to print to. */
    assertConsoleForLogs() {
      if (this.hasConsole)
        return;
      const wants = [
        ...(this.project.system.tasks || []).filter((t) => t.log).map((t) => `task "${t.name}"`),
        ...(this.project.system.commands?.commands || []).filter((c) => c.log).map((c) => `command "${c.match}"`)
      ];
      if (wants.length === 0)
        return;
      throw new CodegenError(`${wants.join(", ")} declares "log:", but the model declares no console. Add one:
  hardware:
    buses:
      console: { interface: uart, port: 0, baud: 115200 }`);
    }
    /** Every action the model actually uses, wherever it was used. */
    everyUsedAction() {
      return [
        ...this.project.system.transitions.flatMap((t) => t.actions || []),
        ...(this.project.system.tasks || []).flatMap((t) => t.actions),
        ...(this.project.system.commands?.commands || []).flatMap((c) => c.actions || [])
      ];
    }
    /**
     * What a guard or action can read, listed by name in the stub.
     *
     * This is the answer to "my action needs a sensor reading - where does it
     * come from". Everything the model declares is already on the context; the
     * stub says so rather than leaving it to be discovered in a header.
     */
    contextDoc() {
      const lines = [];
      for (const parameter of this.project.system.parameters || []) {
        const unit = parameter.unit ? `, ${parameter.unit}` : "";
        lines.push(`  //   ctx->parameters->${this.sanitize(parameter.name)}   (${parameter.type}${unit})`);
      }
      const sensors = (this.project.system.components || []).filter((c) => c.class === "sensor");
      for (const sensor of sensors) {
        const unit = sensor.config?.unit ? `, ${sensor.config.unit}` : "";
        lines.push(`  //   ctx->sensors->${this.sanitize(sensor.name)}   (float${unit}) - you fill this in`);
      }
      if (this.hasMachine) {
        lines.push("  //   ctx->currentState, ctx->previousState   (compare with S_*)");
        lines.push("  //   ctx->eventData   (payload of the event being dispatched)");
      }
      if (lines.length === 0)
        return "";
      return `  //
  // Available on ctx:
${lines.join("\n")}
`;
    }
    /** The two C names a state with timed transitions needs. */
    timerNames(flat) {
      const base = this.sanitize(flat.path);
      return { since: `enteredAt_${base}`, mark: `enter_${base}`, tick: `tick_${base}` };
    }
    /**
     * `after:` on a transition - it fires when a duration elapses instead of when
     * an event arrives. Everything else about it is a normal transition: guards,
     * `do:`, ordering and fall-through all behave identically.
     *
     * PulseHSM has timeoutMs/timeoutNext on addState(), and this deliberately
     * does not use them, for four reasons:
     *
     *  1. timeoutNext is a state index needed *at registration time*, and states
     *     register parents-first in declaration order. Any cycle - go leads to
     *     prepare_stop leads to stop leads back to go - refers forward to a state
     *     whose index is still -1.
     *  2. The runtime only checks the timeout of `currentState`, which is always
     *     a leaf, so a timeout on a composite would never fire. "Filling must not
     *     run past max_fill_ms, whichever phase it is in" needs the composite.
     *  3. One timeout per state cannot carry a guard, actions, or a second
     *     candidate - and the traffic light needs all three on `stop`.
     *  4. timeoutMs is captured once. Reading the parameter every tick means
     *     retuning green_ms at runtime takes effect immediately, instead of
     *     silently keeping whatever the value was at boot.
     *
     * The entry callback stamps the clock and the update callback checks it -
     * both slots the generator owns. Entry only fires when the state is really
     * entered, so moving between two children does not restart their parent's
     * clock, which is exactly the semantics a composite timeout needs.
     */
    generateTimeouts() {
      if (this.timedBySource.size === 0)
        return "";
      const transitions = this.project.system.transitions;
      const blocks = [];
      for (const flat of this.states) {
        const owned = this.timedBySource.get(flat.index);
        if (!owned || owned.length === 0)
          continue;
        const { since, mark, tick } = this.timerNames(flat);
        const body = [];
        for (const idx of owned) {
          const t = transitions[idx];
          const guard = this.guards.get(idx);
          const target = this.states[this.resolveEntry(this.resolveRef(t.target, "target"))];
          const duration = typeof t.after === "string" ? `(unsigned long)systemParameters.${this.sanitize(t.after)}` : `${t.after}UL`;
          const source2 = typeof t.after === "string" ? `${t.after} (parameter)` : `${t.after} ms`;
          const calls = (t.actions || []).map((a) => `    action_${this.sanitize(a.name)}(&systemContext);`).join("\n");
          const fire = [
            calls,
            `    fsm.transitionTo(${target.symbol});`,
            "    return;"
          ].filter(Boolean).join("\n");
          const condition = guard ? `elapsed >= ${duration} && ${guard.fnName}(&systemContext)` : `elapsed >= ${duration}`;
          body.push(`  // after ${source2} -> ${t.target}${guard ? ", if the guard allows" : ""}
  if (${condition}) {
${fire}
  }`);
        }
        blocks.push(`// Timers for "${flat.path}".
static unsigned long ${since} = 0;

static void ${mark}() {
  ${since} = millis();
}

static void ${tick}() {
  syncContext();
  const unsigned long elapsed = millis() - ${since};

${body.join("\n\n")}
}`);
      }
      return `// ============================================================================
// TIMED TRANSITIONS
// ============================================================================
//
// Generated from "after:" in the model. Ancestors tick before their active
// child, so when both a state and its parent time out on the same pass the
// inner one wins - the same precedence event handling already has.
//
// Subtraction on unsigned long is correct across the millis() rollover.

${blocks.join("\n\n")}`;
    }
    /**
     * Catch a runtime compiled against a smaller state table than this model
     * needs.
     *
     * addState() returns -1 when the table is full, and a transition to -1 does
     * nothing at all - the machine ignores states it appears to have. That is
     * exactly what happens when PulseHSM.cpp cannot see PulseHSM_config.h, and
     * it is silent, so the sketch says so itself.
     */
    registrationCheck() {
      if (!this.hasConsole) {
        return `  // No console is declared, so this cannot be reported at runtime. If states
  // seem to be missing - a transition that does nothing - check that
  // PulseHSM_config.h sits beside PulseHSM.h, and declare a console to have
  // the sketch say so itself.
`;
      }
      const test = this.states.map((s) => `${s.symbol} < 0`).join(" ||\n      ");
      const stream = this.consoleStream();
      return `  // A negative index means the runtime ran out of state slots, which happens
  // when PulseHSM.cpp was compiled without seeing PulseHSM_config.h. Silent
  // otherwise: transitions to a dropped state simply do nothing.
  if (${test}) {
    ${stream}.println("FATAL: PulseHSM refused a state - its table is too small.");
    ${stream}.println("       Keep PulseHSM_config.h beside PulseHSM.h and rebuild.");
  }
`;
    }
    // =========================================================================
    // LOOP
    // =========================================================================
    generateLoopFunction() {
      const body = [];
      if (this.project.system.commands)
        body.push("  pollCommands();");
      for (const task of this.project.system.tasks || []) {
        body.push(`  runTask_${this.sanitize(task.name)}();`);
      }
      if (this.hasMachine) {
        const example = this.project.system.events[0];
        const exampleName = example ? `EVENT_${this.sanitizeUpper(example.name)}` : "EVENT_NONE";
        body.push(`  // TODO: Read sensors into systemSensors, then raise events.
  // Example:
  //   systemSensors.temperature = readTemperature();
  //   if (systemSensors.temperature >= systemParameters.setpoint) {
  //     fsm.sendEvent(${exampleName});
  //   }
  //
  // sendEvent() is ISR-safe, so interrupts may call it directly.

  fsm.update();`);
      } else if (body.length === 0) {
        body.push("  // Nothing declared to run. Add tasks: or commands: to the model.");
      }
      const sync = this.project.system.commands || (this.project.system.tasks || []).length ? "  syncContext();\n" : "";
      return `// ============================================================================
// MAIN LOOP
// ============================================================================
//
// Never call delay() here: it stops everything below it from running.

void loop() {
${sync}${body.join("\n")}
}`;
    }
    // =========================================================================
    // GUARD IMPLEMENTATIONS
    // =========================================================================
    generateGuardImplementations() {
      if (!this.hasMachine)
        return "";
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
        const action = this.everyUsedAction().find((a) => a.name === name);
        const paramDoc = action?.params ? Object.entries(action.params).map(([k, v]) => `  //   ${k}: ${JSON.stringify(v)}${this.resolveParamHint(v)}`).join("\n") : "  //   (none)";
        const trace = this.hasConsole && this.isVerbose ? `  ${this.consoleStream()}.println("  -> Action: ${name}");
` : "";
        const pwmHint = action ? this.pwmWriteHint(action) : "";
        return `void action_${this.sanitize(name)}(SystemContext* ctx) {
${trace}  // Declared params for this action (documentation only):
${paramDoc}
${this.contextDoc()}  //
  // TODO: Implement the hardware calls for this action.${pwmHint}
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
      const collect = (actions, where) => {
        for (const action of actions || []) {
          if (!action.name)
            throw new CodegenError(`${where} has an action without a name`);
          this.actionNames.add(action.name);
        }
      };
      this.project.system.transitions.forEach((t, idx) => collect(t.actions, `Transition ${idx}`));
      for (const task of this.project.system.tasks || []) {
        collect(task.actions, `Task "${task.name}"`);
      }
      for (const command of this.project.system.commands?.commands || []) {
        collect(command.actions, `Command "${command.match}"`);
      }
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
        const bucket = t.after !== void 0 ? this.timedBySource : this.transitionsBySource;
        const list = bucket.get(sourceIdx) || [];
        list.push(idx);
        bucket.set(sourceIdx, list);
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

  // dist/src/emit/libraries.js
  var LibraryEmitter = class {
    constructor() {
      this.backend = new InterfaceBackend();
    }
    emit(project) {
      const entries = /* @__PURE__ */ new Map();
      for (const resource of project.system.resources || []) {
        const emission = this.backend.emit(resource, resource.name.toUpperCase());
        for (const library of emission.libraries) {
          if (entries.has(library.name))
            continue;
          entries.set(library.name, {
            name: library.name,
            include: library.include,
            source: library.source,
            reason: `required by ${resource.name} (${resource.interface})`,
            implied: true
          });
        }
      }
      for (const library of project.system.libraries || []) {
        entries.set(library.name, {
          name: library.name,
          include: library.include || `${library.name}.h`,
          source: library.source || "registry",
          ...library.version ? { version: library.version } : {},
          ...library.url ? { url: library.url } : {},
          reason: library.description || "declared in the model",
          implied: false
        });
      }
      const libraries = Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
      return {
        schema: "pulseir/libraries@1",
        project: project.name,
        version: String(project.version),
        libraries,
        platformio: libraries.filter(needsInstalling).map(toLibDep)
      };
    }
    toJSON(project) {
      return JSON.stringify(this.emit(project), null, 2) + "\n";
    }
  };
  function needsInstalling(entry) {
    return entry.source !== "builtin";
  }
  function toLibDep(entry) {
    if (entry.source === "git" && entry.url)
      return entry.url;
    if (entry.source === "local" && entry.url)
      return `file://${entry.url}`;
    return entry.version ? `${entry.name}@${entry.version}` : entry.name;
  }

  // dist/web/highlight.js
  var DEFAULT_KEYWORDS = [
    // Top-level blocks
    "project",
    "target",
    "hardware",
    "buses",
    "devices",
    "machine",
    "tasks",
    "commands",
    "imports",
    "events",
    "resources",
    // project:
    "name",
    "version",
    "pulseir",
    "description",
    // target:
    "board",
    "verbose",
    "drivers",
    // hardware / buses / devices - structure
    "interface",
    "type",
    "class",
    "bus",
    "driver",
    "params",
    "unit",
    // pin / channel descriptors
    "pin",
    "channel",
    "sda",
    "scl",
    "miso",
    "mosi",
    "sck",
    "cs",
    "address",
    "mode",
    "speed",
    // serial / SPI / I2C / MQTT / etc.
    "port",
    "baud",
    "frequency",
    "resolution",
    "bits",
    "host",
    "ssid",
    "password",
    "prefix",
    "topic",
    // machine:
    "initial",
    "states",
    "transitions",
    "entry",
    "exit",
    "from",
    "on",
    "to",
    "do",
    "guard",
    "after",
    "log",
    // tasks:
    "every",
    "parameters",
    "actions",
    "condition",
    "default",
    // commands / actions
    "source",
    "map",
    // parameter / value descriptors
    "min",
    "max",
    "range",
    "value"
  ];
  var KEYWORD_SET = new Set(DEFAULT_KEYWORDS);
  var BOOLEANS = /* @__PURE__ */ new Set(["true", "false", "yes", "no", "on", "off"]);
  var NULLS = /* @__PURE__ */ new Set(["null", "~"]);
  var FLOW_DELIMITERS = /* @__PURE__ */ new Set([",", "{", "}", "[", "]"]);
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var Emitter = class {
    constructor() {
      this.out = [];
    }
    push(kind, text) {
      if (!text)
        return;
      this.out.push(kind === "plain" ? escapeHtml(text) : `<span class="y-${kind}">${escapeHtml(text)}</span>`);
    }
    toString() {
      return this.out.join("");
    }
  };
  function classifyScalar(text) {
    const lower2 = text.toLowerCase();
    if (NULLS.has(lower2))
      return "null";
    if (BOOLEANS.has(lower2))
      return "boolean";
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text))
      return "number";
    if (/^0x[0-9a-fA-F]+$/.test(text))
      return "number";
    return "plain";
  }
  function readQuoted(line, i) {
    const quote = line[i];
    let j = i + 1;
    while (j < line.length) {
      if (quote === '"' && line[j] === "\\") {
        j += 2;
        continue;
      }
      if (line[j] === quote) {
        if (quote === "'" && line[j + 1] === "'") {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return line.length;
  }
  function findKeyColon(line, i, inFlow) {
    let j = i;
    while (j < line.length) {
      const ch = line[j];
      if (ch === '"' || ch === "'") {
        j = readQuoted(line, j);
        continue;
      }
      if (ch === "#" && j > i && /\s/.test(line[j - 1]))
        return -1;
      if (inFlow && FLOW_DELIMITERS.has(ch))
        return -1;
      if (ch === ":") {
        const next = line[j + 1];
        if (next === void 0 || /\s/.test(next) || inFlow && FLOW_DELIMITERS.has(next))
          return j;
      }
      j++;
    }
    return -1;
  }
  function emitValue(out, line, from, flowDepth, keywords) {
    let i = from;
    let depth = flowDepth;
    while (i < line.length) {
      const ch = line[i];
      if (/\s/.test(ch)) {
        const start2 = i;
        while (i < line.length && /\s/.test(line[i]))
          i++;
        out.push("plain", line.slice(start2, i));
        continue;
      }
      if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
        out.push("comment", line.slice(i));
        return;
      }
      if (ch === '"' || ch === "'") {
        const end = readQuoted(line, i);
        out.push("string", line.slice(i, end));
        i = end;
        continue;
      }
      if (ch === "{" || ch === "[") {
        out.push("punct", ch);
        depth++;
        i++;
        continue;
      }
      if (ch === "}" || ch === "]") {
        out.push("punct", ch);
        depth = Math.max(0, depth - 1);
        i++;
        continue;
      }
      if (ch === ",") {
        out.push("punct", ch);
        i++;
        continue;
      }
      if (ch === "&" || ch === "*") {
        const start2 = i++;
        while (i < line.length && !/[\s,{}[\]]/.test(line[i]))
          i++;
        out.push("anchor", line.slice(start2, i));
        continue;
      }
      if (ch === "!") {
        const start2 = i++;
        while (i < line.length && !/[\s,{}[\]]/.test(line[i]))
          i++;
        out.push("tag", line.slice(start2, i));
        continue;
      }
      if (depth > 0) {
        const colon = findKeyColon(line, i, true);
        if (colon !== -1) {
          const rawKey = line.slice(i, colon);
          out.push(keywords.has(rawKey.trim()) ? "key" : "identifier", rawKey);
          out.push("punct", ":");
          i = colon + 1;
          continue;
        }
      }
      const start = i;
      while (i < line.length) {
        const c = line[i];
        if (depth > 0 && (FLOW_DELIMITERS.has(c) || /\s/.test(c)))
          break;
        if (c === "#" && /\s/.test(line[i - 1] ?? " "))
          break;
        i++;
      }
      const text = line.slice(start, i);
      out.push(depth > 0 ? classifyScalar(text) : classifyScalar(text.trimEnd()), text);
    }
  }
  function highlight(source2, keywords) {
    const kw = keywords ?? KEYWORD_SET;
    const lines = source2.split("\n");
    const rendered = [];
    let blockIndent = -1;
    for (const line of lines) {
      const out = new Emitter();
      const indentLength = line.length - line.trimStart().length;
      if (blockIndent !== -1) {
        if (line.trim() === "" || indentLength > blockIndent) {
          out.push("string", line);
          rendered.push(out.toString());
          continue;
        }
        blockIndent = -1;
      }
      if (line.trim() === "") {
        rendered.push(escapeHtml(line));
        continue;
      }
      const indent = line.slice(0, indentLength);
      out.push("plain", indent);
      let i = indentLength;
      if (line.slice(i) === "---" || line.slice(i) === "...") {
        out.push("punct", line.slice(i));
        rendered.push(out.toString());
        continue;
      }
      if (line[i] === "#") {
        out.push("comment", line.slice(i));
        rendered.push(out.toString());
        continue;
      }
      while (line[i] === "-" && (line[i + 1] === " " || line[i + 1] === void 0)) {
        out.push("punct", "-");
        i++;
        const start = i;
        while (i < line.length && line[i] === " ")
          i++;
        out.push("plain", line.slice(start, i));
      }
      const colon = findKeyColon(line, i, false);
      if (colon !== -1) {
        const rawKey = line.slice(i, colon);
        let keyKind;
        if (/^["']/.test(rawKey.trim())) {
          keyKind = "string";
        } else {
          keyKind = kw.has(rawKey.trim()) ? "key" : "identifier";
        }
        out.push(keyKind, rawKey);
        out.push("punct", ":");
        i = colon + 1;
      }
      const rest = line.slice(i);
      const block = /^(\s*)([|>][+-]?\d*)(\s*)(#.*)?$/.exec(rest);
      if (block) {
        out.push("plain", block[1]);
        out.push("punct", block[2]);
        out.push("plain", block[3]);
        if (block[4])
          out.push("comment", block[4]);
        blockIndent = indentLength;
        rendered.push(out.toString());
        continue;
      }
      emitValue(out, line, i, 0, kw);
      rendered.push(out.toString());
    }
    return rendered.join("\n");
  }

  // dist/web/highlight-cpp.js
  var CPP_KEYWORDS = /* @__PURE__ */ new Set([
    "auto",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "constexpr",
    "continue",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "explicit",
    "extern",
    "false",
    "for",
    "friend",
    "goto",
    "if",
    "inline",
    "namespace",
    "new",
    "nullptr",
    "operator",
    "private",
    "protected",
    "public",
    "return",
    "sizeof",
    "static",
    "struct",
    "switch",
    "template",
    "this",
    "throw",
    "true",
    "try",
    "typedef",
    "typename",
    "union",
    "using",
    "virtual",
    "void",
    "volatile",
    "while",
    // Arduino / AVR constants that behave like keywords
    "HIGH",
    "LOW",
    "INPUT",
    "OUTPUT",
    "INPUT_PULLUP",
    "INPUT_PULLDOWN",
    "NULL",
    "PROGMEM",
    "ISR",
    "F"
  ]);
  var CPP_TYPES = /* @__PURE__ */ new Set([
    "bool",
    "char",
    "double",
    "float",
    "int",
    "long",
    "short",
    "signed",
    "unsigned",
    "wchar_t",
    // Fixed-width integer types
    "uint8_t",
    "uint16_t",
    "uint32_t",
    "uint64_t",
    "int8_t",
    "int16_t",
    "int32_t",
    "int64_t",
    "size_t",
    "ptrdiff_t",
    "uintptr_t",
    "intptr_t",
    // Arduino / C++ stdlib types
    "String",
    "boolean",
    "byte",
    "word"
  ]);
  function escapeCpp(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var CppEmitter = class {
    constructor() {
      this.out = [];
    }
    push(kind, text) {
      if (!text)
        return;
      this.out.push(kind === "plain" ? escapeCpp(text) : `<span class="c-${kind}">${escapeCpp(text)}</span>`);
    }
    toString() {
      return this.out.join("");
    }
  };
  function highlightCpp(source2) {
    const lines = source2.split("\n");
    const rendered = [];
    let inBlockComment = false;
    for (const line of lines) {
      const out = new CppEmitter();
      let i = 0;
      if (inBlockComment) {
        const end = line.indexOf("*/");
        if (end === -1) {
          out.push("comment", line);
          rendered.push(out.toString());
          continue;
        }
        out.push("comment", line.slice(0, end + 2));
        i = end + 2;
        inBlockComment = false;
      }
      if (line.slice(i).trim() === "") {
        out.push("plain", line.slice(i));
        rendered.push(out.toString());
        continue;
      }
      let isInclude = false;
      const ppMatch = /^(\s*)(#\s*[a-z]+)/i.exec(line.slice(i));
      if (ppMatch) {
        out.push("plain", ppMatch[1]);
        out.push("preproc", ppMatch[2]);
        i += ppMatch[0].length;
        isInclude = ppMatch[2].replace(/\s/g, "") === "#include";
      }
      while (i < line.length) {
        const ch = line[i];
        if (ch === " " || ch === "	") {
          const start = i;
          while (i < line.length && (line[i] === " " || line[i] === "	"))
            i++;
          out.push("plain", line.slice(start, i));
          continue;
        }
        if (ch === "/" && line[i + 1] === "/") {
          out.push("comment", line.slice(i));
          i = line.length;
          continue;
        }
        if (ch === "/" && line[i + 1] === "*") {
          const end = line.indexOf("*/", i + 2);
          if (end === -1) {
            out.push("comment", line.slice(i));
            i = line.length;
            inBlockComment = true;
          } else {
            out.push("comment", line.slice(i, end + 2));
            i = end + 2;
          }
          continue;
        }
        if (ch === '"') {
          let j = i + 1;
          while (j < line.length && line[j] !== '"') {
            if (line[j] === "\\")
              j++;
            j++;
          }
          out.push("string", line.slice(i, j + 1));
          i = j + 1;
          continue;
        }
        if (ch === "'") {
          let j = i + 1;
          while (j < line.length && line[j] !== "'") {
            if (line[j] === "\\")
              j++;
            j++;
          }
          out.push("string", line.slice(i, j + 1));
          i = j + 1;
          continue;
        }
        if (isInclude && ch === "<") {
          const end = line.indexOf(">", i + 1);
          if (end !== -1) {
            out.push("string", line.slice(i, end + 1));
            i = end + 1;
            continue;
          }
        }
        if (/\d/.test(ch) || ch === "." && /\d/.test(line[i + 1] ?? "")) {
          const start = i;
          if (ch === "0" && /[xX]/.test(line[i + 1] ?? "")) {
            i += 2;
            while (i < line.length && /[0-9a-fA-F]/.test(line[i]))
              i++;
          } else if (ch === "0" && /[bB]/.test(line[i + 1] ?? "")) {
            i += 2;
            while (i < line.length && /[01]/.test(line[i]))
              i++;
          } else {
            while (i < line.length && /\d/.test(line[i]))
              i++;
            if (line[i] === "." && /\d/.test(line[i + 1] ?? "")) {
              i++;
              while (i < line.length && /\d/.test(line[i]))
                i++;
            }
            if (/[eE]/.test(line[i] ?? "")) {
              i++;
              if (/[+\-]/.test(line[i] ?? ""))
                i++;
              while (i < line.length && /\d/.test(line[i]))
                i++;
            }
          }
          while (i < line.length && /[uUlLfF]/.test(line[i]))
            i++;
          out.push("number", line.slice(start, i));
          continue;
        }
        if (/[a-zA-Z_]/.test(ch)) {
          const start = i;
          while (i < line.length && /[a-zA-Z0-9_]/.test(line[i]))
            i++;
          const word = line.slice(start, i);
          if (CPP_KEYWORDS.has(word)) {
            out.push("keyword", word);
          } else if (CPP_TYPES.has(word)) {
            out.push("type", word);
          } else {
            out.push("plain", word);
          }
          continue;
        }
        if (/[{}()[\];,.<>=!&|+\-*/%^~?:]/.test(ch)) {
          out.push("punct", ch);
          i++;
          continue;
        }
        out.push("plain", ch);
        i++;
      }
      rendered.push(out.toString());
    }
    return rendered.join("\n");
  }

  // dist/web/projects.js
  var PROJECTS_KEY = "pulseir.projects";
  var CURRENT_KEY = "pulseir.currentProject";
  var LEGACY_KEY = "pulseir.workspace";
  function nameFromModel(yaml2, fallback) {
    const block = /^project:[^\S\n]*\n(?:[^\S\n]+.*\n?)*/m.exec(yaml2)?.[0];
    const name = block ? /^[^\S\n]+name:[^\S\n]*(?:"([^"]*)"|'([^']*)'|(\S+))/m.exec(block) : null;
    const found = name?.[1] ?? name?.[2] ?? name?.[3];
    return found?.trim() || fallback;
  }
  var counter = 0;
  function newId() {
    counter += 1;
    return `p${Date.now().toString(36)}${counter.toString(36)}`;
  }
  var lastStamp = 0;
  function stamp() {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return lastStamp;
  }
  var ProjectStore = class {
    constructor(storage) {
      this.storage = storage;
    }
    readAll() {
      const raw = this.storage.getItem(PROJECTS_KEY);
      if (!raw)
        return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    writeAll(projects) {
      this.storage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    }
    /** Every project, most recently updated first. */
    list() {
      return Object.values(this.readAll()).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    get(id) {
      return this.readAll()[id] ?? null;
    }
    /** The project last opened, or the most recent one, or null when empty. */
    current() {
      const id = this.storage.getItem(CURRENT_KEY);
      if (id) {
        const found = this.get(id);
        if (found)
          return found;
      }
      return this.list()[0] ?? null;
    }
    setCurrent(id) {
      this.storage.setItem(CURRENT_KEY, id);
    }
    /** A name not already taken, by appending a number. */
    uniqueName(wanted) {
      const taken = new Set(this.list().map((p) => p.name));
      if (!taken.has(wanted))
        return wanted;
      for (let n = 2; ; n++) {
        const candidate = `${wanted} ${n}`;
        if (!taken.has(candidate))
          return candidate;
      }
    }
    create(name, files, entry) {
      const project = {
        id: newId(),
        name: this.uniqueName(name),
        files: { ...files },
        entry,
        active: entry,
        updatedAt: stamp()
      };
      const all = this.readAll();
      all[project.id] = project;
      this.writeAll(all);
      this.setCurrent(project.id);
      return project;
    }
    /** Store the current contents of a project. Touches updatedAt. */
    save(project) {
      const all = this.readAll();
      all[project.id] = { ...project, updatedAt: stamp() };
      this.writeAll(all);
    }
    rename(id, name) {
      const all = this.readAll();
      const project = all[id];
      if (!project)
        return null;
      const others = new Set(Object.values(all).filter((p) => p.id !== id).map((p) => p.name));
      let unique = name;
      for (let n = 2; others.has(unique); n++)
        unique = `${name} ${n}`;
      project.name = unique;
      project.updatedAt = stamp();
      this.writeAll(all);
      return project;
    }
    duplicate(id) {
      const source2 = this.get(id);
      if (!source2)
        return null;
      return this.create(`${source2.name} copy`, source2.files, source2.entry);
    }
    /** Removes it, and returns whatever should be opened next. */
    remove(id) {
      const all = this.readAll();
      delete all[id];
      this.writeAll(all);
      const next = this.list()[0] ?? null;
      if (next)
        this.setCurrent(next.id);
      else
        this.storage.removeItem(CURRENT_KEY);
      return next;
    }
    /**
     * Bring the pre-projects single workspace across, once.
     *
     * Someone with work in the old key must not lose it just because the editor
     * grew projects. Returns the migrated project, or null when there was none.
     */
    migrateLegacy() {
      const raw = this.storage.getItem(LEGACY_KEY);
      if (!raw)
        return null;
      try {
        const old = JSON.parse(raw);
        if (!old?.files || !old.entry || old.files[old.entry] === void 0) {
          this.storage.removeItem(LEGACY_KEY);
          return null;
        }
        const project = this.create(nameFromModel(old.files[old.entry], "My model"), old.files, old.entry);
        this.storage.removeItem(LEGACY_KEY);
        return project;
      } catch {
        this.storage.removeItem(LEGACY_KEY);
        return null;
      }
    }
  };
  var MODEL_FILE = /\.ya?ml$/i;
  function foldImport(paths) {
    const names = Object.keys(paths).filter((p) => MODEL_FILE.test(p) && !p.split("/").some(isJunk));
    if (names.length === 0)
      return { files: {}, folder: null };
    const folder = commonFolder(names);
    const files = {};
    for (const name of names) {
      files[folder ? name.slice(folder.length + 1) : name] = paths[name];
    }
    return { files, folder };
  }
  function isJunk(segment) {
    return segment === "__MACOSX" || segment === ".git" || segment.startsWith("._");
  }
  function commonFolder(names) {
    const first = names[0].split("/");
    if (first.length < 2)
      return null;
    const candidate = first[0];
    return names.every((n) => n.startsWith(`${candidate}/`)) ? candidate : null;
  }
  function importedName(files, entry, folder, fallback) {
    if (folder)
      return folder;
    return nameFromModel(files[entry] ?? "", fallback);
  }
  function findEntry(files) {
    const names = Object.keys(files).sort();
    const declares = names.filter((n) => /^project:/m.test(files[n]));
    if (declares.length === 1)
      return declares[0];
    if (declares.length > 1) {
      return declares.find((n) => /^pulse\.ya?ml$/i.test(n)) ?? declares[0];
    }
    return names[0] ?? null;
  }

  // dist/web/zip.js
  var CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let bit = 0; bit < 8; bit++)
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 4294967295;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    }
    return (c ^ 4294967295) >>> 0;
  }
  var Writer = class {
    constructor() {
      this.parts = [];
      this.length = 0;
    }
    bytes(part) {
      this.parts.push(part);
      this.length += part.length;
    }
    u16(value) {
      const part = new Uint8Array(2);
      new DataView(part.buffer).setUint16(0, value, true);
      this.bytes(part);
    }
    u32(value) {
      const part = new Uint8Array(4);
      new DataView(part.buffer).setUint32(0, value >>> 0, true);
      this.bytes(part);
    }
    finish() {
      const out = new Uint8Array(this.length);
      let at = 0;
      for (const part of this.parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    }
  };
  function dosStamp(when) {
    return {
      time: when.getHours() << 11 | when.getMinutes() << 5 | when.getSeconds() >> 1,
      // Years count from 1980, and the format cannot go earlier.
      date: Math.max(1980, when.getFullYear()) - 1980 << 9 | when.getMonth() + 1 << 5 | when.getDate()
    };
  }
  var UTF8_NAMES = 2048;
  function zip(files, when = /* @__PURE__ */ new Date()) {
    const encoder = new TextEncoder();
    const stamp2 = dosStamp(when);
    const out = new Writer();
    const central = [];
    for (const [path, text] of Object.entries(files)) {
      const name = encoder.encode(path);
      const data = encoder.encode(text);
      const crc = crc32(data);
      const offset = out.length;
      out.u32(67324752);
      out.u16(20);
      out.u16(UTF8_NAMES);
      out.u16(0);
      out.u16(stamp2.time);
      out.u16(stamp2.date);
      out.u32(crc);
      out.u32(data.length);
      out.u32(data.length);
      out.u16(name.length);
      out.u16(0);
      out.bytes(name);
      out.bytes(data);
      central.push({ name, crc, size: data.length, offset });
    }
    const centralStart = out.length;
    for (const entry of central) {
      out.u32(33639248);
      out.u16(20);
      out.u16(20);
      out.u16(UTF8_NAMES);
      out.u16(0);
      out.u16(stamp2.time);
      out.u16(stamp2.date);
      out.u32(entry.crc);
      out.u32(entry.size);
      out.u32(entry.size);
      out.u16(entry.name.length);
      out.u16(0);
      out.u16(0);
      out.u16(0);
      out.u16(0);
      out.u32(0);
      out.u32(entry.offset);
      out.bytes(entry.name);
    }
    out.u32(101010256);
    out.u16(0);
    out.u16(0);
    out.u16(central.length);
    out.u16(central.length);
    out.u32(out.length - centralStart);
    out.u32(centralStart);
    out.u16(0);
    return out.finish();
  }
  var ZipError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ZipError";
    }
  };
  async function inflateRaw(data) {
    if (typeof DecompressionStream === "undefined") {
      throw new ZipError("This zip is compressed, and this browser cannot decompress it. Re-export it, or import the folder instead of the zip.");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(input) {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    let eocd = -1;
    const earliest = Math.max(0, input.length - 22 - 65535);
    for (let at2 = input.length - 22; at2 >= earliest; at2--) {
      if (view.getUint32(at2, true) === 101010256) {
        eocd = at2;
        break;
      }
    }
    if (eocd === -1)
      throw new ZipError("Not a zip file (no end-of-central-directory record)");
    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const files = {};
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (at + 46 > input.length || view.getUint32(at, true) !== 33639248) {
        throw new ZipError(`Damaged zip: central directory entry ${i + 1} is not where it should be`);
      }
      const method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const localAt = view.getUint32(at + 42, true);
      const name = decoder.decode(input.subarray(at + 46, at + 46 + nameLength));
      at += 46 + nameLength + extraLength + commentLength;
      if (name.endsWith("/"))
        continue;
      if (view.getUint32(localAt, true) !== 67324752) {
        throw new ZipError(`Damaged zip: "${name}" does not start with a local file header`);
      }
      const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
      const raw = input.subarray(dataAt, dataAt + compressed);
      if (method === 0) {
        files[name] = raw.slice();
      } else if (method === 8) {
        files[name] = await inflateRaw(raw);
      } else {
        throw new ZipError(`"${name}" uses compression method ${method}, which is not supported`);
      }
    }
    return files;
  }

  // dist/web/examples.js
  var EXAMPLES = {
    "starter \u2014 a two-state blinker": {
      entry: "blinker.yaml",
      files: {
        "blinker.yaml": '# A minimal model. Edit anything and the panes update as you type.\nproject:\n  name: blinker\n  version: "1.0"\n\ntarget:\n  board: esp32\n\nhardware:\n  devices:\n    led:\n      type: digital_output\n      pin: GPIO2\n\nparameters:\n  blink_ms:\n    type: int\n    default: 500\n    range: [50, 5000]\n    unit: ms\n\nevents:\n  PRESS:\n    source: external\n\nmachine:\n  states:\n    off:\n    on:\n\n  transitions:\n    - from: off\n      on: PRESS\n      to: on\n      do: led_on\n\n    - from: on\n      on: PRESS\n      to: off\n      do: led_off\n'
      }
    },
    "blink \u2014 no state machine at all, just a task": {
      entry: "blink.yaml",
      files: {
        "blink.yaml": '# The smallest useful thing a board can do, with no state machine at all.\n#\n# PulseHSM is one tenant of this IR, not its foundation. A blink is scheduling,\n# not behaviour worth a state chart, so it is a `task:` - and the generated\n# sketch contains no PulseHSM, no fsm, and no event enum. It is plain Arduino.\n#\n# What the model still buys you: the pin is named, its pinMode is generated,\n# the interval is a declared parameter with a range, and `toggle_led` arrives\n# as a stub with the right signature.\n\npulseir: "1"\n\nproject:\n  name: blink\n  version: "1.0"\n  description: One LED, one interval\n\ntarget:\n  board: esp32\n\nhardware:\n  devices:\n    led: { type: digital_output, pin: GPIO2 }\n\nparameters:\n  # Read on every pass, so changing it at runtime takes effect immediately.\n  blink_ms: { type: int, default: 500, range: [50, 10000], unit: ms }\n\ntasks:\n  blink:\n    every: blink_ms\n    do: toggle_led\n    description: Flip the LED over\n\n# Implementing toggle_led:\n#\n#   static bool lit = false;\n#   lit = !lit;\n#   digitalWrite(LED_PIN, lit ? HIGH : LOW);\n#\n# Hold the state; do not read the pin back with\n# `digitalWrite(LED_PIN, !digitalRead(LED_PIN))`. On an ESP32 `pinMode(OUTPUT)`\n# leaves the input buffer off, so digitalRead returns 0 whatever the pin is\n# driving - the LED goes on once and stays on. It happens to work on an AVR,\n# which is why the idiom is so common. Holding the state is also one register\n# write instead of a read and a write, and works on every board.\n'
      }
    },
    "serial console \u2014 commands over the serial monitor, no state machine": {
      entry: "serial_console.yaml",
      files: {
        "serial_console.yaml": '# A board you talk to over the serial monitor. Still no state machine.\n#\n# Two things the model owns here that are usually hand-written boilerplate:\n#\n#   1. The console\'s baud rate. `console` is a declared bus like any other, so\n#      the sketch opens it at the rate the model asks for - there is no\n#      hardcoded Serial.begin(115200) anywhere in the output.\n#   2. The command table. Reading a line without blocking, reassembling one\n#      split across loop() passes, and refusing one too long to fit are all\n#      generated. What a command *means* is your action, in C.\n\npulseir: "1"\n\nproject:\n  name: serial_console\n  version: "1.0"\n  description: Answers commands typed into the serial monitor\n\ntarget:\n  board: esp32\n\nhardware:\n  buses:\n    # Port 0 is the USB serial monitor. Naming it as a bus is what lets the\n    # model set the baud rate.\n    console: { interface: uart, port: 0, baud: 9600 }\n\n  devices:\n    led:  { type: digital_output, pin: GPIO2 }\n    fan:  { type: pwm_output, pin: GPIO27, channel: 0, frequency: 25000 }\n    temp: { type: analog_input, pin: GPIO34, unit: degC }\n\nparameters:\n  report_ms: { type: int, default: 2000, range: [200, 60000], unit: ms }\n  fan_duty:  { type: int, default: 128,  range: [0, 255] }\n\nactions:\n  led_on:    { driver: gpio_control, params: { device: led, value: HIGH } }\n  led_off:   { driver: gpio_control, params: { device: led, value: LOW } }\n  fan_start: { driver: pwm_control,  params: { device: fan, duty: fan_duty } }\n  fan_stop:  { driver: pwm_control,  params: { device: fan, duty: 0 } }\n  read_temp: { driver: adc_read,     params: { device: temp } }\n  show_help: { driver: console_help }\n\ncommands:\n  source: console\n  map:\n    on:   led_on\n    off:  led_off\n    fan:  fan_start\n    stop: fan_stop\n    help: show_help\n\n    # `log:` prints a line, with {name} filled from a declared parameter or\n    # sensor. The text and the values both come from this file - no printf in\n    # sight, and a typo in a name is a model error, not a C++ one.\n    status:\n      do: read_temp\n      log: "temp={temp} degC  fan_duty={fan_duty}"\n\n    # A command may also just answer, without doing anything.\n    setpoint:\n      log: "reporting every {report_ms} ms"\n\ntasks:\n  # The board reports on its own too, not only when asked. The log line runs\n  # after the actions, so it prints the reading just taken.\n  heartbeat:\n    every: report_ms\n    do: read_temp\n    log: "temp={temp} degC"\n    description: Report even when nobody types anything\n'
      }
    },
    "boiler \u2014 multi-file, hierarchical states, guards": {
      entry: "pulse.yaml",
      files: {
        "hardware.yaml": "# What is physically wired up.\n#\n# The machine refers to `pump` and `heater`, never to GPIO25 - so the same\n# behaviour survives a change of board or a change of pinout.\n\nhardware:\n  buses:\n    sensor_bus:\n      interface: onewire\n      pin: GPIO4\n      description: OneWire bus for the temperature probe\n\n  devices:\n    water_temp:\n      type: ds18b20\n      bus: sensor_bus\n      unit: degC\n      description: Boiler water temperature\n\n    pump:\n      type: digital_output\n      pin: GPIO25\n\n    heater:\n      type: pwm_output\n      pin: GPIO27\n      channel: 0\n      frequency: 5000\n      resolution: 8\n\n    cooling_fan:\n      type: digital_output\n      pin: GPIO32\n",
        "machine.yaml": '# Behaviour: what the system reacts to, and how it moves.\n#\n# Guards and actions are names only. You implement them in src/ - see\n# FUNCTION_CONTRACT.md.\n\nevents:\n  START:\n    source: external\n    description: User presses start\n  STOP:\n    source: external\n  TEMP_REACHED:\n    source: sensor\n  OVER_TEMP:\n    source: sensor\n  EMERGENCY_STOP:\n    source: external\n\nactions:\n  start_pump:\n    driver: gpio_control\n    params: {device: pump, value: HIGH}\n  stop_pump:\n    driver: gpio_control\n    params: {device: pump, value: LOW}\n  reduce_heat:\n    driver: pwm_control\n    params: {device: heater, duty: 30}\n  activate_cooling:\n    driver: gpio_control\n    params: {device: cooling_fan, value: HIGH}\n  shutdown_all:\n    driver: gpio_control\n    params: {devices: [pump, heater, cooling_fan], value: LOW}\n\nmachine:\n  states:\n    idle:\n      description: System is off\n    running:\n      initial: heating\n      states:\n        heating:\n        maintaining:\n        cooling:\n    fault:\n\n  transitions:\n    - from: idle\n      on: START\n      to: running          # enters running/heating\n      do: start_pump\n\n    - from: running        # applies from any child\n      on: STOP\n      to: idle\n      do: stop_pump\n\n    - from: running/heating\n      on: TEMP_REACHED\n      guard:\n        name: temp_at_setpoint\n        description: water temperature has reached the setpoint\n      to: running/maintaining\n      do: reduce_heat\n\n    - from: running/maintaining\n      on: OVER_TEMP\n      guard:\n        name: over_safe_temp\n        description: temperature has exceeded the safety limit\n      to: running/cooling\n      do: activate_cooling\n\n    - from: "*"\n      on: EMERGENCY_STOP\n      to: fault\n      do: shutdown_all\n',
        "parameters.yaml": "# Configuration contract. These become a C struct, and the dashboard reads\n# their unit and range straight from here.\n\nparameters:\n  setpoint:\n    type: float\n    default: 60.0\n    range: [10.0, 90.0]\n    unit: degC\n    description: Target temperature\n\n  max_safe_temp:\n    type: float\n    default: 75.0\n    range: [50.0, 95.0]\n    unit: degC\n    description: Emergency shutdown temperature\n\n  hysteresis:\n    type: float\n    default: 2.0\n    range: [0.1, 10.0]\n    unit: degC\n    description: Temperature tolerance band\n",
        "pulse.yaml": '# Entry file. Only this one declares `project`.\n#\n#   hardware.yaml    buses and devices\n#   parameters.yaml  tunable configuration\n#   machine.yaml     events, states and transitions\n#   src/             your C++ - guards and actions live here\n#\n# Generate with:\n#   pulse-ir examples/boiler/pulse.yaml --outdir build/boiler\n\nproject:\n  name: boiler_control\n  version: "1.0"\n  description: Simple boiler temperature control system\n\ntarget:\n  board: esp32\n\nimports:\n  - hardware.yaml\n  - parameters.yaml\n  - machine.yaml\n'
      }
    },
    "hierarchy \u2014 nesting and inner-vs-outer precedence": {
      entry: "hierarchy.yaml",
      files: {
        "hierarchy.yaml": '# Fixture exercising the parts of the IR the boiler example does not reach:\n#   - entering a composite state descends to its initial child (recursively)\n#   - a transition on an enclosing state applies to nested children\n#   - an inner transition outranks an enclosing one on the same event\n#   - a transition may carry several actions\n#   - the bare `guard: <name>` shorthand (boiler covers the mapping form)\n\nproject:\n  name: hierarchy_test\n  version: "1.0"\n  description: Hierarchy and dispatch semantics fixture\n\nevents:\n  GO:\n    source: external\n  NEXT:\n    source: internal\n  ABORT:\n    source: external\n  BLOCKED:\n    source: internal\n\nmachine:\n  states:\n    off:\n    active:\n      initial: phase_one\n      states:\n        phase_one:\n        # Nested two levels deep, so entry has to descend more than once.\n        phase_two:\n          initial: deep\n          states:\n            deep:\n    halted:\n\n  transitions:\n    # Target is composite: entry must land on active/phase_one.\n    - from: off\n      on: GO\n      to: active\n      do: [log_start, arm_system]\n\n    # Target is composite and nested: entry must land on active/phase_two/deep.\n    - from: phase_one\n      on: NEXT\n      to: phase_two\n\n    # Enclosing source: applies while any descendant of active is current.\n    - from: active\n      on: ABORT\n      to: halted\n\n    # Inner source on the same event: must outrank the `active` transition\n    # whenever phase_one is the current state.\n    - from: phase_one\n      on: ABORT\n      to: off\n\n    # Named guard; the generated stub returns false, so this stays blocked.\n    - from: phase_one\n      on: BLOCKED\n      to: halted\n      guard: never_ready\n'
      }
    },
    "greenhouse \u2014 interfaces, libraries and MQTT": {
      entry: "greenhouse.yaml",
      files: {
        "greenhouse.yaml": '# Multi-file model. Only this file declares `project`.\n#\n#   hardware.yaml    buses and devices\n#   parameters.yaml  tunable configuration\n#   machine.yaml     events, states and transitions\n#\n# Paths are relative to this file. Each name may only be defined once across\n# the whole model, so two files cannot silently collide.\n\nproject:\n  name: greenhouse\n  version: "1.0"\n  description: Climate control for a small greenhouse\n\ntarget:\n  board: esp32\n\nimports:\n  - hardware.yaml\n  - parameters.yaml\n  - machine.yaml\n',
        "hardware.yaml": '# Buses, devices and third-party libraries.\n#\n# Only libraries the platform does not imply need declaring: Wire, SPI and\n# WiFi come with the interfaces below.\n\nlibraries:\n  - name: Adafruit_BME280\n    include: Adafruit_BME280.h\n    version: "^2.2"\n    source: registry\n    description: Temperature, humidity and pressure over I2C\n\nhardware:\n  buses:\n    sensor_bus:\n      interface: i2c\n      sda: GPIO21\n      scl: GPIO22\n      frequency: 400000\n      library: Adafruit_BME280\n      description: Shared I2C bus for climate sensors\n\n    card_slot:\n      interface: spi\n      sck: GPIO18\n      miso: GPIO19\n      mosi: GPIO23\n      cs: GPIO5\n      description: SD card for offline logging\n\n    gps:\n      interface: uart\n      port: 2\n      baud: 9600\n      rx: GPIO16\n      tx: GPIO17\n\n    uplink:\n      interface: wifi\n      ssid: greenhouse-ap\n      hostname: greenhouse-01\n\n    broker:\n      interface: mqtt\n      host: mqtt.example.local\n      port: 8883\n      tls: true\n\n  devices:\n    air_temp:\n      type: bme280\n      bus: sensor_bus\n      address: 0x76\n      unit: degC\n\n    humidity:\n      type: bme280\n      bus: sensor_bus\n      address: 0x76\n      unit: percent\n\n    vent:\n      type: pwm_output\n      pin: GPIO25\n      channel: 0\n      frequency: 5000\n      resolution: 8\n\n    pump:\n      type: digital_output\n      pin: GPIO26\n',
        "machine.yaml": 'events:\n  START:\n    source: external\n    description: Local start button\n  STOP:\n    source: external\n  SAMPLE_DUE:\n    source: timer\n  TOO_HOT:\n    source: sensor\n  RECOVERED:\n    source: sensor\n  SENSOR_FAULT:\n    source: internal\n  # Declaring the source as mqtt is what makes this remotely triggerable.\n  REMOTE_START:\n    source: mqtt\n    description: Start requested from the dashboard\n\nactions:\n  open_log:\n    driver: sd_log\n  start_sampling:\n    driver: scheduler\n  stop_all:\n    driver: gpio_control\n    params: {devices: [vent, pump], value: LOW}\n  read_climate:\n    driver: bme280\n  publish_climate:\n    driver: mqtt_publish\n  open_vent:\n    driver: pwm_control\n    params: {device: vent, duty: 100}\n  close_vent:\n    driver: pwm_control\n    params: {device: vent, duty: 0}\n  raise_alarm:\n    driver: mqtt_publish\n\nmachine:\n  states:\n    idle:\n      description: Powered but not regulating\n    running:\n      initial: sampling\n      states:\n        sampling:\n        venting:\n    fault:\n\n  transitions:\n    - from: idle\n      on: START\n      to: running\n      do: [open_log, start_sampling]\n\n    - from: idle\n      on: REMOTE_START\n      to: running\n      do: [open_log, start_sampling]\n\n    - from: running\n      on: STOP\n      to: idle\n      do: stop_all\n\n    - from: running/sampling\n      on: SAMPLE_DUE\n      to: running/sampling\n      do: [read_climate, publish_climate]\n\n    - from: running/sampling\n      on: TOO_HOT\n      guard:\n        name: above_temp_setpoint\n        description: air temperature is above the setpoint plus hysteresis\n      to: running/venting\n      do: open_vent\n\n    - from: running/venting\n      on: RECOVERED\n      guard: back_within_band\n      to: running/sampling\n      do: close_vent\n\n    - from: "*"\n      on: SENSOR_FAULT\n      to: fault\n      do: [stop_all, raise_alarm]\n',
        "parameters.yaml": "parameters:\n  temp_setpoint:\n    type: float\n    default: 26.0\n    range: [10.0, 40.0]\n    unit: degC\n    description: Target air temperature\n\n  hysteresis:\n    type: float\n    default: 1.5\n    range: [0.1, 5.0]\n    unit: degC\n    description: Band around the setpoint before venting\n\n  sample_interval:\n    type: int\n    default: 5000\n    range: [500, 60000]\n    unit: ms\n    description: How often to sample the climate\n"
      }
    },
    "traffic light \u2014 phases, a pedestrian request and a night mode": {
      entry: "traffic_light.yaml",
      files: {
        "traffic_light.yaml": '# Traffic light with a pedestrian request.\n#\n# Single file: at this size, splitting would cost more than it saves.\n#\n# Every phase change here is driven by time, and `after:` says so directly:\n# the generated code owns the clock, so there is no TIMER_EXPIRED event to\n# raise and nothing to compare against millis() by hand.\n\nproject:\n  name: traffic_light\n  version: "1.0"\n  description: Signalised crossing with a pedestrian phase\n\ntarget:\n  board: esp32\n\nhardware:\n  devices:\n    lamp_red:    { type: digital_output, pin: GPIO25 }\n    lamp_amber:  { type: digital_output, pin: GPIO26 }\n    lamp_green:  { type: digital_output, pin: GPIO27 }\n    walk_lamp:   { type: digital_output, pin: GPIO12 }\n    walk_button: { type: digital_input,  pin: GPIO14, mode: INPUT_PULLUP }\n\nparameters:\n  green_ms:  { type: int, default: 20000, range: [5000, 120000], unit: ms }\n  amber_ms:  { type: int, default: 3000,  range: [2000, 6000],   unit: ms }\n  flash_ms:  { type: int, default: 1000,  range: [200, 5000],    unit: ms }\n  red_ms:    { type: int, default: 15000, range: [5000, 120000], unit: ms }\n  walk_ms:   { type: int, default: 12000, range: [5000, 60000],  unit: ms }\n\nevents:\n  WALK_REQUEST:  { source: external, description: Pedestrian pressed the button }\n  GO_NIGHT:      { source: external }\n  GO_DAY:        { source: external }\n\nactions:\n  show_green:  { driver: gpio_control, params: {device: lamp_green, value: HIGH} }\n  show_amber:  { driver: gpio_control, params: {device: lamp_amber, value: HIGH} }\n  show_red:    { driver: gpio_control, params: {device: lamp_red,   value: HIGH} }\n  show_walk:   { driver: gpio_control, params: {device: walk_lamp,  value: HIGH} }\n  clear_walk:  { driver: gpio_control, params: {device: walk_lamp,  value: LOW} }\n  all_lamps_off: { driver: gpio_control, params: {devices: [lamp_red, lamp_amber, lamp_green], value: LOW} }\n  latch_request: { driver: request_latch }\n  flash_amber:   { driver: gpio_control, params: {device: lamp_amber, value: TOGGLE} }\n  # `night` flashes by toggling from its own update code rather than a timed\n  # self-transition: `after` may not point at its own state, because that would\n  # restart the clock forever and the state could never be left.\n\nmachine:\n  states:\n    operating:\n      initial: go\n      states:\n        go:\n        prepare_stop:\n        stop:\n        walk:\n    night:\n\n  transitions:\n    # GATE FINDING: this wants to be an *internal* transition - handle the\n    # event, run the action, stay put. The model has no way to say that, so it\n    # is written as a self-transition. Harmless today because states have no\n    # entry/exit actions, but wrong the moment they do.\n    - from: operating/go\n      on: WALK_REQUEST\n      to: operating/go\n      do: latch_request\n\n    - from: operating/go\n      after: green_ms\n      to: operating/prepare_stop\n      do: [all_lamps_off, show_amber]\n\n    - from: operating/prepare_stop\n      after: amber_ms\n      to: operating/stop\n      do: [all_lamps_off, show_red]\n\n    # Two candidates on the same timer, in order: a waiting pedestrian gets the\n    # crossing, otherwise traffic goes. Exactly how two transitions on one event\n    # behave - a blocked guard falls through to the next.\n    - from: operating/stop\n      after: red_ms\n      guard:\n        name: walk_requested\n        description: a pedestrian pressed the button during this cycle\n      to: operating/walk\n      do: show_walk\n\n    - from: operating/stop\n      after: red_ms\n      to: operating/go\n      do: [all_lamps_off, show_green]\n\n    - from: operating/walk\n      after: walk_ms\n      to: operating/go\n      do: [clear_walk, all_lamps_off, show_green]\n\n    - from: operating\n      on: GO_NIGHT\n      to: night\n      do: all_lamps_off\n\n    - from: night\n      on: GO_DAY\n      to: operating\n      do: [all_lamps_off, show_green]\n'
      }
    },
    "motor controller \u2014 speed phases and an overcurrent trip": {
      entry: "motor_controller.yaml",
      files: {
        "motor_controller.yaml": '# Brushed DC motor with direction, speed ramp and overcurrent trip.\n#\n# GATE FINDING: the ramp itself (accelerate at N rpm/s) is arithmetic over\n# time, so it belongs in C - the model only says *which phase* the motor is\n# in. That is the escape hatch working exactly as intended.\n\nproject:\n  name: motor_controller\n  version: "1.0"\n  description: Speed-controlled DC motor with overcurrent protection\n\ntarget:\n  board: esp32\n\nhardware:\n  devices:\n    drive_pwm:   { type: pwm_output,    pin: GPIO25, channel: 0, frequency: 20000, resolution: 10 }\n    dir_forward: { type: digital_output, pin: GPIO26 }\n    dir_reverse: { type: digital_output, pin: GPIO27 }\n    # GPIO34/35 are input-only on this part, which suits a sense input.\n    current_sense: { type: analog_input, pin: GPIO34, unit: A }\n    estop:         { type: digital_input, pin: GPIO35 }\n\nparameters:\n  target_rpm:     { type: int,   default: 1200, range: [0, 3000],   unit: rpm }\n  ramp_rate:      { type: int,   default: 300,  range: [10, 2000],  unit: rpm_per_s }\n  trip_current:   { type: float, default: 4.5,  range: [0.5, 20.0], unit: A }\n  restart_delay:  { type: int,   default: 5000, range: [0, 60000],  unit: ms }\n\nevents:\n  START:       { source: external }\n  STOP:        { source: external }\n  REVERSE:     { source: external }\n  AT_SPEED:    { source: internal, description: Ramp reached the target }\n  OVERCURRENT: { source: sensor }\n  ESTOP:       { source: external }\n  RESET:       { source: external }\n\nactions:\n  engage_forward: { driver: gpio_control, params: {device: dir_forward, value: HIGH} }\n  engage_reverse: { driver: gpio_control, params: {device: dir_reverse, value: HIGH} }\n  release_drive:  { driver: pwm_control,  params: {device: drive_pwm, duty: 0} }\n  begin_ramp:     { driver: ramp }\n  hold_speed:     { driver: pwm_control }\n  begin_coast:    { driver: ramp, params: {to: 0} }\n  latch_fault:    { driver: fault_latch }\n  clear_fault:    { driver: fault_latch, params: {clear: true} }\n\nmachine:\n  states:\n    stopped:\n    running:\n      initial: accelerating\n      states:\n        accelerating:\n        cruising:\n        decelerating:\n    tripped:\n      initial: locked\n      states:\n        # The restart delay is a state you have to sit through, not a clock the\n        # C code keeps. RESET is simply not wired up until the delay is over.\n        locked:\n        resettable:\n\n  transitions:\n    - from: stopped\n      on: START\n      to: running\n      do: [engage_forward, begin_ramp]\n\n    - from: running/accelerating\n      on: AT_SPEED\n      to: running/cruising\n      do: hold_speed\n\n    - from: running\n      on: STOP\n      to: running/decelerating\n      do: begin_coast\n\n    - from: running/decelerating\n      on: AT_SPEED\n      to: stopped\n      do: release_drive\n\n    - from: running/cruising\n      on: REVERSE\n      to: running/decelerating\n      do: begin_coast\n\n    # Overcurrent and e-stop must work from any phase of running, and from\n    # stopped too - a shorted output can trip with the drive released.\n    - from: "*"\n      on: OVERCURRENT\n      guard:\n        name: over_trip_current\n        description: sensed current exceeded trip_current for the debounce window\n      to: tripped\n      do: [release_drive, latch_fault]\n\n    - from: "*"\n      on: ESTOP\n      to: tripped\n      do: [release_drive, latch_fault]\n\n    - from: tripped/locked\n      after: restart_delay\n      to: tripped/resettable\n\n    - from: tripped/resettable\n      on: RESET\n      to: stopped\n      do: clear_fault\n'
      }
    },
    "pump & tank \u2014 float switches, dry-run and overfill": {
      entry: "pump_tank.yaml",
      files: {
        "pump_tank.yaml": '# Tank level control with dry-run protection.\n#\n# Float switches are the classic hysteresis case: fill until the high float\n# closes, then wait for the low float to open before filling again.\n\nproject:\n  name: pump_tank\n  version: "1.0"\n  description: Tank fill control with dry-run and overflow protection\n\ntarget:\n  board: esp32\n\nhardware:\n  devices:\n    pump:        { type: digital_output, pin: GPIO25 }\n    inlet_valve: { type: digital_output, pin: GPIO26 }\n    alarm:       { type: digital_output, pin: GPIO27 }\n    float_low:   { type: digital_input,  pin: GPIO34, mode: INPUT }\n    float_high:  { type: digital_input,  pin: GPIO35, mode: INPUT }\n    flow_sense:  { type: digital_input,  pin: GPIO14, mode: INPUT_PULLUP }\n\nparameters:\n  dry_run_ms:    { type: int, default: 8000,  range: [1000, 60000], unit: ms }\n  settle_ms:     { type: int, default: 2000,  range: [200, 30000],  unit: ms }\n  max_fill_ms:   { type: int, default: 600000, range: [10000, 3600000], unit: ms }\n\nevents:\n  LEVEL_LOW:     { source: sensor, description: Low float opened }\n  LEVEL_HIGH:    { source: sensor, description: High float closed }\n  NO_FLOW:       { source: sensor, description: Flow sensor saw nothing while pumping }\n  FAULT_RESET:   { source: external }\n\nactions:\n  start_pump:  { driver: gpio_control, params: {device: pump, value: HIGH} }\n  stop_pump:   { driver: gpio_control, params: {device: pump, value: LOW} }\n  open_inlet:  { driver: gpio_control, params: {device: inlet_valve, value: HIGH} }\n  close_inlet: { driver: gpio_control, params: {device: inlet_valve, value: LOW} }\n  raise_alarm: { driver: gpio_control, params: {device: alarm, value: HIGH} }\n  clear_alarm: { driver: gpio_control, params: {device: alarm, value: LOW} }\n\nmachine:\n  states:\n    idle:\n      description: Level is fine; waiting for the low float\n    filling:\n      initial: priming\n      states:\n        priming:\n          description: Pump on, waiting to see flow before trusting it\n        pumping:\n    fault:\n      initial: dry_run\n      states:\n        dry_run:\n        overfill:\n\n  transitions:\n    - from: idle\n      on: LEVEL_LOW\n      to: filling\n      do: [open_inlet, start_pump]\n\n    - from: filling/priming\n      on: NO_FLOW\n      to: fault/dry_run\n      do: [stop_pump, close_inlet, raise_alarm]\n\n    # Two timers on one state, in order. For the first settle_ms nothing can\n    # fire; between settle_ms and dry_run_ms the guarded one gets its chance\n    # each pass; if flow never appears, the unguarded one trips at dry_run_ms.\n    - from: filling/priming\n      after: settle_ms\n      guard:\n        name: flow_established\n        description: the flow sensor has been pulsing steadily\n      to: filling/pumping\n\n    - from: filling/priming\n      after: dry_run_ms\n      to: fault/dry_run\n      do: [stop_pump, close_inlet, raise_alarm]\n\n    - from: filling\n      on: LEVEL_HIGH\n      to: idle\n      do: [stop_pump, close_inlet]\n\n    # Overfill: the high float should have stopped us. If we are still filling\n    # past max_fill_ms, something is stuck.\n    #\n    # The timer is on the *composite*, so it measures the whole fill and is not\n    # restarted by moving from priming to pumping.\n    - from: filling\n      after: max_fill_ms\n      to: fault/overfill\n      do: [stop_pump, close_inlet, raise_alarm]\n\n    - from: fault\n      on: FAULT_RESET\n      to: idle\n      do: clear_alarm\n'
      }
    },
    "sensor gateway \u2014 a field bus, an uplink and degraded operation": {
      entry: "pulse.yaml",
      files: {
        "hardware.yaml": 'libraries:\n  - name: ModbusMaster\n    include: ModbusMaster.h\n    version: "^2.0"\n    source: registry\n    description: Modbus RTU over RS-485\n\nhardware:\n  buses:\n    field_bus:\n      interface: uart\n      port: 2\n      baud: 19200\n      rx: GPIO16\n      tx: GPIO17\n      library: ModbusMaster\n      description: RS-485 to the field devices\n\n    local_bus:\n      interface: i2c\n      sda: GPIO21\n      scl: GPIO22\n      frequency: 100000\n\n    uplink:\n      interface: wifi\n      ssid: plant-scada\n      hostname: gateway-01\n\n    broker:\n      interface: mqtt\n      host: mqtt.plant.local\n      port: 8883\n      tls: true\n\n  devices:\n    cabinet_temp: { type: bme280, bus: local_bus, address: 0x76, unit: degC }\n    cabinet_rh:   { type: bme280, bus: local_bus, address: 0x76, unit: percent }\n    # Field readings arrive over Modbus, so they have no pin of their own.\n    line_pressure: { type: modbus_input, class: sensor, bus: field_bus, register: 30001, unit: bar }\n    line_flow:     { type: modbus_input, class: sensor, bus: field_bus, register: 30003, unit: lpm }\n    status_led:    { type: digital_output, pin: GPIO2 }\n    fault_relay:   { type: digital_output, pin: GPIO26 }\n',
        "machine.yaml": 'parameters:\n  poll_interval:  { type: int, default: 2000,  range: [200, 60000],  unit: ms }\n  publish_every:  { type: int, default: 5000,  range: [1000, 300000], unit: ms }\n  retry_backoff:  { type: int, default: 5000,  range: [1000, 120000], unit: ms }\n  max_retries:    { type: int, default: 5,     range: [1, 100] }\n\nevents:\n  LINK_UP:       { source: internal }\n  LINK_DOWN:     { source: internal }\n  BROKER_UP:     { source: internal }\n  BROKER_DOWN:   { source: internal }\n  POLL_DUE:      { source: timer }\n  PUBLISH_DUE:   { source: timer }\n  FIELD_TIMEOUT: { source: internal, description: A field device stopped answering }\n  RESET:         { source: mqtt, description: Remote reset from the dashboard }\n\nactions:\n  begin_wifi:      { driver: wifi_connect }\n  begin_broker:    { driver: mqtt_connect }\n  poll_field:      { driver: modbus_poll }\n  publish_batch:   { driver: mqtt_publish }\n  buffer_batch:    { driver: ring_buffer, params: {on_full: drop_oldest} }\n  drain_buffer:    { driver: ring_buffer, params: {drain: true} }\n  show_ok:         { driver: gpio_control, params: {device: status_led, value: HIGH} }\n  show_degraded:   { driver: gpio_control, params: {device: status_led, value: TOGGLE} }\n  trip_fault:      { driver: gpio_control, params: {device: fault_relay, value: HIGH} }\n  clear_fault:     { driver: gpio_control, params: {device: fault_relay, value: LOW} }\n\nmachine:\n  states:\n    starting:\n    connecting:\n      initial: joining_wifi\n      states:\n        joining_wifi:\n        joining_broker:\n        # An attempt that has timed out waits here before the next one. Two\n        # states, because a timer restarts on entry and so a state cannot\n        # usefully time out into itself.\n        backoff:\n    online:\n      initial: polling\n      states:\n        polling:\n        publishing:\n    # Keep sampling with no uplink: the point of a gateway is not to lose data.\n    degraded:\n    faulted:\n\n  transitions:\n    - from: starting\n      after: 250\n      to: connecting\n      do: begin_wifi\n\n    - from: connecting/joining_wifi\n      on: LINK_UP\n      to: connecting/joining_broker\n      do: begin_broker\n\n    - from: connecting/joining_broker\n      on: BROKER_UP\n      to: online\n      do: [show_ok, drain_buffer]\n\n    # Retry loop: an attempt that has not succeeded within retry_backoff drops\n    # into backoff, which starts the next one.\n    - from: connecting/joining_wifi\n      after: retry_backoff\n      to: connecting/backoff\n\n    - from: connecting/joining_broker\n      after: retry_backoff\n      to: connecting/backoff\n\n    - from: connecting/backoff\n      after: 250\n      to: connecting/joining_wifi\n      do: begin_wifi\n\n    - from: online/polling\n      on: POLL_DUE\n      to: online/polling\n      do: poll_field\n\n    - from: online\n      on: PUBLISH_DUE\n      to: online/publishing\n      do: publish_batch\n\n    - from: online/publishing\n      on: POLL_DUE\n      to: online/polling\n      do: poll_field\n\n    - from: online\n      on: BROKER_DOWN\n      to: degraded\n      do: show_degraded\n\n    - from: online\n      on: LINK_DOWN\n      to: degraded\n      do: show_degraded\n\n    # Degraded still samples; readings queue until the uplink returns.\n    - from: degraded\n      on: POLL_DUE\n      to: degraded\n      do: [poll_field, buffer_batch]\n\n    - from: degraded\n      after: retry_backoff\n      to: connecting\n      do: begin_wifi\n\n    - from: "*"\n      on: FIELD_TIMEOUT\n      guard:\n        name: retries_exhausted\n        description: a field device missed max_retries consecutive polls\n      to: faulted\n      do: trip_fault\n\n    - from: "*"\n      on: RESET\n      to: starting\n      do: clear_fault\n',
        "pulse.yaml": '# Industrial sensor gateway: read a field bus, publish upstream.\n#\n# Multi-file, because unlike the other three this one has enough hardware and\n# enough behaviour that one file would be hard to review.\n\nproject:\n  name: sensor_gateway\n  version: "1.0"\n  description: Reads field sensors and republishes them to a dashboard\n\ntarget:\n  board: esp32\n\nimports:\n  - hardware.yaml\n  - machine.yaml\n'
      }
    }
  };

  // dist/web/main.js
  function normalizeYaml(source2) {
    return source2.split("\n").map((line) => {
      if (line.trimStart().startsWith("#"))
        return line;
      return line.replace(/([a-zA-Z_]\w*):([^\s\n:/])/g, "$1: $2");
    }).join("\n");
  }
  var $ = (id) => {
    const el = document.getElementById(id);
    if (!el)
      throw new Error(`missing element #${id}`);
    return el;
  };
  var source = $("source");
  var highlightLayer = $("highlight");
  var gutter = $("gutter");
  var gutterLines = $("gutter-lines");
  var highlightCode = $("highlight-code");
  var status = $("status");
  var fileBar = $("file-bar");
  var panes = {
    sketch: $("pane-sketch"),
    topics: $("pane-topics"),
    libraries: $("pane-libraries"),
    structure: $("pane-structure")
  };
  var exampleSelect = $("example");
  var projectButton = $("project-button");
  var projectName = $("project-name");
  var projectMenu = $("project-menu");
  var importZipInput = $("import-zip");
  var importFolderInput = $("import-folder");
  var copyYamlButton = $("copy-yaml");
  var copyOutputButton = $("copy-output");
  var snippetButton = $("snippet-button");
  var snippetMenu = $("snippet-menu");
  var namespaceInput = $("namespace");
  var namespaceLabel = $("namespace-label");
  var boardSelect = $("board");
  var staleNote = $("stale-note");
  var downloadButton = $("download-button");
  var downloadMenu = $("download-menu");
  var themeButton = $("theme-button");
  var mqttTab = $("tab-topics");
  var settingsButton = $("settings-button");
  var settingsModal = $("settings-modal");
  var keywordChips = $("keyword-chips");
  var keywordInput = $("keyword-input");
  var store = new ProjectStore(localStorage);
  var workspace = { id: "", name: "", files: {}, entry: "", active: "", updatedAt: 0 };
  var current = null;
  function fileNames() {
    const rest = Object.keys(workspace.files).filter((n) => n !== workspace.entry).sort();
    return workspace.entry ? [workspace.entry, ...rest] : rest;
  }
  function openProject(project) {
    workspace = project;
    store.setCurrent(project.id);
    source.value = workspace.files[workspace.active] ?? "";
    projectName.textContent = project.name;
    renderFileBar();
    paint();
    clearOutput();
    render();
  }
  function restore() {
    const migrated = store.migrateLegacy();
    if (migrated)
      return migrated;
    const existing = store.current();
    if (existing)
      return existing;
    const label = Object.keys(EXAMPLES)[0];
    const example = EXAMPLES[label];
    return store.create(nameFromModel(example.files[example.entry], "My model"), example.files, example.entry);
  }
  function persist() {
    if (workspace.id)
      store.save(workspace);
  }
  var BLANK_MODEL = `# A new PulseIR model.
# Use Insert \u25BE in the toolbar to add hardware, devices, tasks and logic.
pulseir: "1"

project:
  name: untitled
  version: "1.0"

target:
  board: esp32
`;
  var HIGHLIGHT_LIMIT = 2e5;
  var highlightingOn = true;
  function paint() {
    const text = source.value;
    paintGutter();
    if (text.length > HIGHLIGHT_LIMIT) {
      if (highlightingOn) {
        highlightingOn = false;
        source.style.color = "var(--text)";
        highlightLayer.hidden = true;
      }
      syncScroll();
      return;
    }
    if (!highlightingOn) {
      highlightingOn = true;
      source.style.color = "";
      highlightLayer.hidden = false;
    }
    highlightCode.innerHTML = `${highlight(text, activeKeywords)}
`;
    syncScroll();
  }
  function syncScroll() {
    const x = source.scrollLeft;
    const y = source.scrollTop;
    highlightCode.style.transform = `translate(${-x}px, ${-y}px)`;
    gutterLines.style.transform = `translateY(${-y}px)`;
  }
  var badLine = null;
  function paintGutter() {
    const lines = source.value.split("\n").length;
    const digits = Math.max(2, String(lines).length);
    document.documentElement.style.setProperty("--gutter-width", `calc(${digits}ch + 22px)`);
    const numbers = [];
    for (let n = 1; n <= lines; n++) {
      numbers.push(`<span class="ln${n === badLine ? " bad" : ""}">${n}</span>`);
    }
    gutterLines.innerHTML = numbers.join("");
  }
  function setBadLine(line) {
    if (badLine === line)
      return;
    badLine = line;
    paintGutter();
  }
  function escapeHtml2(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function withLineNumbers(html) {
    const lines = html.split("\n");
    const width = String(lines.length).length;
    return lines.map((line, i) => `<span class="ln-num">${String(i + 1).padStart(width)}</span> ${line}`).join("\n");
  }
  function setStale(stale) {
    staleNote.hidden = !stale;
    for (const pane of Object.values(panes))
      pane.classList.toggle("stale", stale);
  }
  function clearOutput() {
    current = null;
    for (const pane of Object.values(panes))
      pane.innerHTML = "";
    setStale(false);
    setDownloadReady(false);
    setMqttTabVisible(false);
  }
  function setDownloadReady(ready) {
    downloadButton.disabled = !ready;
    downloadButton.classList.toggle("ready", ready);
  }
  function setMqttTabVisible(visible) {
    const wasActive = !panes.topics.hidden;
    mqttTab.hidden = !visible;
    if (wasActive && !visible) {
      selectTab("sketch");
    }
    if (visible && !wasActive && panes.sketch.hidden) {
      selectTab("topics");
    }
  }
  function showGuide() {
    const machineIcon = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="5" cy="11" r="3.5"/>
    <circle cx="17" cy="11" r="3.5"/>
    <path d="M8.5 11h5"/>
    <path d="M12 8.5l2.5 2.5-2.5 2.5"/>
  </svg>`;
    const tasksIcon = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 11A7 7 0 1 1 11 4"/>
    <path d="M11 1.5l3.5 3.5-3.5 3.5"/>
  </svg>`;
    const commandsIcon = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="4 6 10 11 4 16"/>
    <line x1="13" y1="16" x2="18" y2="16"/>
  </svg>`;
    const cards = [
      {
        icon: machineIcon,
        label: "machine:",
        desc: "State machine \u2014 define states and the events that move between them. Use Insert \u25BE \u2192 Logic \u2192 State machine."
      },
      {
        icon: tasksIcon,
        label: "tasks:",
        desc: "Repeating background work \u2014 read a sensor, blink an LED, publish MQTT. Use Insert \u25BE \u2192 Logic \u2192 Task."
      },
      {
        icon: commandsIcon,
        label: "commands:",
        desc: "Serial command dispatch \u2014 map text commands arriving over UART to actions. Use Insert \u25BE \u2192 Logic \u2192 Command table."
      }
    ];
    const cardHtml = cards.map((c) => `
    <div class="guide-card">
      <div class="guide-card-icon">${c.icon}</div>
      <div class="guide-card-label"><code>${escapeHtml2(c.label)}</code></div>
      <p class="guide-card-desc">${escapeHtml2(c.desc)}</p>
    </div>`).join("");
    panes.sketch.innerHTML = `
    <div class="guide">
      <p class="guide-title">\u2713 Project setup complete</p>
      <p class="guide-sub">Your project, board, and version are configured. Add at least one of these sections to generate code:</p>
      <div class="guide-cards">${cardHtml}</div>
      <p class="guide-hint">
        Tip: use the <kbd>Insert \u25BE</kbd> button in the toolbar to add any of these with a single click.
      </p>
    </div>`;
  }
  function setStatus(kind, title, detail = "") {
    status.className = `status ${kind}`;
    const detailHtml = detail ? `<span>${escapeHtml2(detail).replace(/\n/g, "<br>")}</span>` : "";
    status.innerHTML = `<strong>${escapeHtml2(title)}</strong>${detailHtml}`;
  }
  function renderFileBar() {
    const names = fileNames();
    fileBar.innerHTML = names.map((name) => {
      const isEntry = name === workspace.entry;
      const isActive = name === workspace.active;
      const badge = isEntry ? '<span class="entry-badge" title="entry file">\u25B6</span>' : "";
      const close = !isEntry ? `<span class="close" data-close="${escapeHtml2(name)}" title="Delete ${escapeHtml2(name)}">\xD7</span>` : "";
      return `<button class="filetab${isActive ? " active" : ""}" data-file="${escapeHtml2(name)}"
      title="${escapeHtml2(name)} (double-click to rename)">${badge}${escapeHtml2(name)}${close}</button>`;
    }).join("");
    for (const tab of fileBar.querySelectorAll(".filetab")) {
      const name = tab.dataset.file;
      tab.addEventListener("click", (event) => {
        const target = event.target;
        if (target.dataset.close) {
          event.stopPropagation();
          deleteFile(target.dataset.close);
          return;
        }
        selectFile(name);
      });
      tab.addEventListener("dblclick", () => renameFile(name));
    }
  }
  function renderStructure(project) {
    const { system } = project;
    const flat = flattenStates(system.states);
    const sections = [];
    if (flat.length > 0) {
      const tree = flat.filter((s) => s.depth === 0).map((s) => renderStateNode(s.path, flat)).join("");
      sections.push(`
      <h3>State hierarchy</h3>
      <p class="hint">A machine only ever rests in a <em>leaf</em>. Entering a
      composite state descends to its initial child, marked \u25B8.</p>
      <div class="tree">${tree}</div>`);
    }
    if (system.transitions.length > 0) {
      const rows = system.transitions.map((t) => {
        const targetPath = resolvePath(system.states, t.target);
        const leaf = targetPath ? resolveEntryLeaf(system.states, targetPath) : null;
        const descends = leaf && targetPath && leaf !== targetPath;
        const target = descends ? `${escapeHtml2(t.target)} <span class="arrow">\u21B3</span> <code>${escapeHtml2(leaf)}</code>` : escapeHtml2(t.target);
        const guard = t.guard ? `<code>${escapeHtml2(t.guard.name)}</code>` : '<span class="dim">\u2014</span>';
        const actions = t.actions?.length ? t.actions.map((a) => `<code>${escapeHtml2(a.name)}</code>`).join(" ") : '<span class="dim">\u2014</span>';
        const src = t.source === "*" ? '<span class="tag wild">any state</span>' : `<code>${escapeHtml2(t.source)}</code>`;
        const trigger = t.event !== void 0 ? `<code>${escapeHtml2(t.event)}</code>` : `<span class="tag timer">after</span> <code>${escapeHtml2(String(t.after))}</code>`;
        return `<tr><td>${src}</td><td>${trigger}</td><td>${target}</td><td>${guard}</td><td>${actions}</td></tr>`;
      }).join("");
      sections.push(`
      <h3>Transitions</h3>
      <p class="hint">A transition on an enclosing state also applies to its
      children, and an inner transition on the same event wins.</p>
      <table>
        <thead><tr><th>From</th><th>Trigger</th><th>To</th><th>Guard</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
    }
    const resources = system.resources ?? [];
    if (resources.length > 0) {
      const rows = resources.map((r) => `<tr>
        <td><code>${escapeHtml2(r.name)}</code></td>
        <td><span class="tag">${escapeHtml2(String(r.interface))}</span></td>
        <td>${Object.entries(r.binding ?? {}).map(([k, v]) => `<code>${escapeHtml2(k)}=${escapeHtml2(String(v))}</code>`).join(" ") || '<span class="dim">\u2014</span>'}</td>
      </tr>`).join("");
      sections.push(`
      <h3>Interfaces</h3>
      <table>
        <thead><tr><th>Resource</th><th>Interface</th><th>Binding</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
    }
    const cmdSet = system.commands;
    if (cmdSet?.commands?.length) {
      const rows = cmdSet.commands.map((c) => {
        const acts = c.actions?.length ? c.actions.map((a) => `<code>${escapeHtml2(a.name)}</code>`).join(" ") : '<span class="dim">\u2014</span>';
        const ev = c.event ? `<code>${escapeHtml2(c.event)}</code>` : '<span class="dim">\u2014</span>';
        const reply = c.log ? `<code>${escapeHtml2(c.log)}</code>` : '<span class="dim">\u2014</span>';
        return `<tr><td><code>${escapeHtml2(c.match)}</code></td><td>${acts}</td><td>${ev}</td><td>${reply}</td></tr>`;
      }).join("");
      const src = cmdSet.source ? ` <span class="dim">\u2014 source: <code>${escapeHtml2(cmdSet.source)}</code></span>` : "";
      sections.push(`
      <h3>Commands${src}</h3>
      <table>
        <thead><tr><th>Command</th><th>Actions</th><th>Event</th><th>Reply</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
    }
    const tasks = system.tasks ?? [];
    if (tasks.length > 0) {
      const rows = tasks.map((t) => {
        const acts = t.actions.length ? t.actions.map((a) => `<code>${escapeHtml2(a.name)}</code>`).join(" ") : '<span class="dim">\u2014</span>';
        const log = t.log ? `<code>${escapeHtml2(t.log)}</code>` : '<span class="dim">\u2014</span>';
        return `<tr><td><code>${escapeHtml2(t.name)}</code></td><td><code>${escapeHtml2(String(t.every))}</code> ms</td><td>${acts}</td><td>${log}</td></tr>`;
      }).join("");
      sections.push(`
      <h3>Tasks</h3>
      <table>
        <thead><tr><th>Name</th><th>Interval</th><th>Actions</th><th>Log</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
    }
    const parameters = system.parameters ?? [];
    if (parameters.length > 0) {
      const rows = parameters.map((p) => {
        const range = p.min !== void 0 && p.max !== void 0 ? `<code>${escapeHtml2(String(p.min))}\u2013${escapeHtml2(String(p.max))}</code>` : '<span class="dim">\u2014</span>';
        const unit = p.unit ? `<code>${escapeHtml2(p.unit)}</code>` : '<span class="dim">\u2014</span>';
        return `<tr><td><code>${escapeHtml2(p.name)}</code></td><td><span class="tag">${escapeHtml2(p.type)}</span></td><td><code>${escapeHtml2(String(p.default))}</code></td><td>${range}</td><td>${unit}</td></tr>`;
      }).join("");
      sections.push(`
      <h3>Parameters</h3>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Range</th><th>Unit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
    }
    if (sections.length === 0) {
      return '<p class="dim" style="padding:16px 20px">Nothing to show yet \u2014 add hardware:, tasks:, commands:, or machine: to populate this view.</p>';
    }
    return sections.join("\n");
  }
  function renderStateNode(path, flat) {
    const node = flat.find((s) => s.path === path);
    const children = flat.filter((s) => s.parentPath === path);
    const label = escapeHtml2(node.state.name);
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
    persist();
    const entryText = workspace.files[workspace.entry] ?? "";
    const rawBoard = /^[ \t]*board:\s*(\S+)/m.exec(entryText)?.[1] ?? "";
    syncBoard(rawBoard);
    let project;
    const parser = new Parser();
    try {
      const normalizedFiles = Object.fromEntries(Object.entries(workspace.files).map(([k, v]) => [k, normalizeYaml(v)]));
      const resolver = new MemoryResolver(normalizedFiles);
      project = parser.parseFrom(workspace.entry, resolver);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const line = error instanceof ParseError && error.line !== void 0 ? error.line + 1 : null;
      if (error instanceof ParseError && error.kind === "empty-model") {
        setBadLine(null);
        clearOutput();
        showGuide();
        setStatus("info", `${workspace.name} \u2014 project ready`, "Add machine:, tasks:, or commands: to generate code.");
        return;
      }
      setBadLine(line !== null && workspace.active === workspace.entry ? line : null);
      const kind = error instanceof ParseError ? "Model error" : "YAML syntax error";
      setStatus("error", `${kind}${line !== null ? ` (line ${line})` : ""}`, message);
      if (current !== null)
        setStale(true);
      return;
    }
    let sketch;
    let topics;
    let libraries;
    try {
      sketch = new Codegen().generate(project);
      topics = new TopicEmitter().toJSON(project, namespaceInput.value.trim() || void 0);
      libraries = new LibraryEmitter().toJSON(project);
    } catch (error) {
      setStatus("error", "Generation error", error instanceof Error ? error.message : String(error));
      if (current !== null)
        setStale(true);
      return;
    }
    setBadLine(null);
    setStale(false);
    panes.sketch.innerHTML = `<pre><code>${withLineNumbers(highlightCpp(sketch))}</code></pre>`;
    panes.topics.innerHTML = `<pre><code>${withLineNumbers(escapeHtml2(topics))}</code></pre>`;
    panes.libraries.innerHTML = `<pre><code>${withLineNumbers(escapeHtml2(libraries))}</code></pre>`;
    panes.structure.innerHTML = renderStructure(project);
    const fileCount = Object.keys(workspace.files).length;
    const counts = [
      fileCount > 1 ? `${fileCount} files` : null,
      `${project.system.events.length} events`,
      `${project.system.transitions.length} transitions`,
      `${(project.system.resources || []).length} resources`,
      `${sketch.split("\n").length} lines generated`
    ].filter(Boolean).join(" \xB7 ");
    if (parser.warnings.length > 0) {
      const warnDetail = [counts, ...parser.warnings.map((w) => `\u26A0 ${w}`)].join("\n");
      setStatus("warn", project.name, warnDetail);
    } else {
      setStatus("ok", project.name, counts);
    }
    current = { project, sketch, topics, libraries };
    setDownloadReady(true);
    const hasMqtt = (project.system.resources ?? []).some((r) => String(r.interface) === "mqtt");
    setMqttTabVisible(hasMqtt);
    syncBoard(project.target?.board ?? "");
  }
  function syncBoard(board) {
    boardSelect.value = board;
    boardSelect.classList.toggle("unset", board === "");
  }
  var THEME_KEY = "pulseir.theme";
  var THEME_ICONS = {
    auto: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <path d="M8 2v12M2 8h12" opacity=".35"/>
    <path fill="currentColor" stroke="none" d="M8 2a6 6 0 0 1 0 12V2z"/>
    <circle cx="8" cy="8" r="6"/>
  </svg>`,
    light: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <circle cx="8" cy="8" r="3"/>
    <line x1="8" y1="1" x2="8" y2="2.5"/>
    <line x1="8" y1="13.5" x2="8" y2="15"/>
    <line x1="1" y1="8" x2="2.5" y2="8"/>
    <line x1="13.5" y1="8" x2="15" y2="8"/>
    <line x1="3.05" y1="3.05" x2="4.1" y2="4.1"/>
    <line x1="11.9" y1="11.9" x2="12.95" y2="12.95"/>
    <line x1="12.95" y1="3.05" x2="11.9" y2="4.1"/>
    <line x1="4.1" y1="11.9" x2="3.05" y2="12.95"/>
  </svg>`,
    dark: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <path d="M13.5 10A6 6 0 0 1 6 2.5a5.5 5.5 0 1 0 7.5 7.5z"/>
  </svg>`
  };
  var THEME_LABELS = {
    auto: "Theme: auto (follows system)",
    light: "Theme: light",
    dark: "Theme: dark"
  };
  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
    themeButton.innerHTML = THEME_ICONS[theme];
    themeButton.title = THEME_LABELS[theme];
  }
  function cycleTheme() {
    const current2 = localStorage.getItem(THEME_KEY) ?? "auto";
    const next = current2 === "auto" ? "light" : current2 === "light" ? "dark" : "auto";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }
  var KEYWORD_STORAGE_KEY = "pulseir.keywords";
  function loadKeywords() {
    const raw = localStorage.getItem(KEYWORD_STORAGE_KEY);
    if (!raw)
      return new Set(DEFAULT_KEYWORDS);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return new Set(parsed);
      }
    } catch {
    }
    return new Set(DEFAULT_KEYWORDS);
  }
  function saveKeywords() {
    localStorage.setItem(KEYWORD_STORAGE_KEY, JSON.stringify([...activeKeywords].sort()));
  }
  var activeKeywords = loadKeywords();
  function renderKeywordChips() {
    keywordChips.replaceChildren();
    for (const word of [...activeKeywords].sort()) {
      const chip = document.createElement("span");
      chip.className = "keyword-chip";
      const label = document.createElement("code");
      label.textContent = word;
      const remove = document.createElement("button");
      remove.className = "chip-remove";
      remove.title = `Remove '${word}'`;
      remove.setAttribute("aria-label", `Remove ${word}`);
      remove.textContent = "\xD7";
      remove.addEventListener("click", () => {
        activeKeywords.delete(word);
        saveKeywords();
        renderKeywordChips();
        paint();
      });
      chip.append(label, remove);
      keywordChips.append(chip);
    }
  }
  function addKeyword() {
    const word = keywordInput.value.trim();
    if (!word)
      return;
    activeKeywords.add(word);
    saveKeywords();
    renderKeywordChips();
    keywordInput.value = "";
    keywordInput.focus();
    paint();
  }
  function openSettings() {
    renderKeywordChips();
    settingsModal.hidden = false;
    keywordInput.value = "";
    keywordInput.focus();
  }
  function closeSettings() {
    settingsModal.hidden = true;
  }
  function applyBoardToYaml(board) {
    let text = source.value;
    if (/^[ \t]*board:/m.test(text)) {
      if (board === "") {
        text = text.replace(/^[ \t]*board:.*\n?/m, "");
      } else {
        text = text.replace(/^([ \t]*board:).*$/m, `$1 ${board}`);
      }
    } else if (/^target:/m.test(text)) {
      text = text.replace(/^(target:.*)$/m, `$1
  board: ${board}`);
    } else {
      const m = /^project:/m.exec(text);
      if (m) {
        text = text.slice(0, m.index) + `target:
  board: ${board}

` + text.slice(m.index);
      } else {
        text = `target:
  board: ${board}

` + text;
      }
    }
    source.value = text;
    workspace.files[workspace.active] = text;
    paint();
  }
  function addImportToYaml(text, filename) {
    const entry = `  - ${filename}`;
    const block = /^([ \t]*imports:[ \t]*\n(?:[ \t]+-[^\n]*\n)*)/m.exec(text);
    if (block) {
      const at = block.index + block[0].length;
      return text.slice(0, at) + entry + "\n" + text.slice(at);
    }
    const proj = /^project:[^\n]*\n(?:[ \t]+[^\n]*\n?)*/m.exec(text);
    if (proj) {
      const at = proj.index + proj[0].length;
      return text.slice(0, at) + `
imports:
${entry}
` + text.slice(at);
    }
    return `imports:
${entry}

` + text;
  }
  function selectFile(name) {
    if (workspace.files[name] === void 0)
      return;
    workspace.active = name;
    source.value = workspace.files[name];
    paint();
    renderFileBar();
    persist();
  }
  function addFile() {
    const name = prompt("New file name", "part.yaml");
    if (!name)
      return;
    const clean = name.trim();
    if (!clean.endsWith(".yaml") && !clean.endsWith(".yml")) {
      alert("Model files must end in .yaml or .yml");
      return;
    }
    if (workspace.files[clean] !== void 0) {
      alert(`"${clean}" already exists`);
      return;
    }
    workspace.files[clean] = `# ${clean}
`;
    const entryText = workspace.files[workspace.entry] ?? "";
    const wired = addImportToYaml(entryText, clean);
    workspace.files[workspace.entry] = wired;
    if (workspace.active === workspace.entry)
      source.value = wired;
    selectFile(clean);
    render();
  }
  function renameFile(name) {
    const next = prompt(`Rename "${name}" to`, name);
    if (!next || next === name)
      return;
    const clean = next.trim();
    if (workspace.files[clean] !== void 0) {
      alert(`"${clean}" already exists`);
      return;
    }
    workspace.files[clean] = workspace.files[name];
    delete workspace.files[name];
    if (workspace.entry === name)
      workspace.entry = clean;
    if (workspace.active === name)
      workspace.active = clean;
    selectFile(workspace.active);
    render();
  }
  function deleteFile(name) {
    if (name === workspace.entry) {
      alert("The entry file cannot be deleted. Make another file the entry first.");
      return;
    }
    if (!confirm(`Delete "${name}"?`))
      return;
    delete workspace.files[name];
    if (workspace.active === name)
      workspace.active = workspace.entry;
    selectFile(workspace.active);
    render();
  }
  function setEntry() {
    if (workspace.active === workspace.entry)
      return;
    workspace.entry = workspace.active;
    renderFileBar();
    render();
  }
  function newProject(label) {
    const template = label ? EXAMPLES[label] : null;
    const files = template ? { ...template.files } : { "pulse.yaml": BLANK_MODEL };
    const entry = template ? template.entry : "pulse.yaml";
    const suggested = nameFromModel(files[entry], template ? label : "untitled");
    const name = prompt("Project name", store.uniqueName(suggested));
    if (!name?.trim())
      return;
    openProject(store.create(name.trim(), files, entry));
  }
  function applyNameToYaml(name) {
    const text = workspace.files[workspace.entry];
    if (!text)
      return;
    const updated = text.replace(/^(project:[^\S\n]*\n)((?:[ \t]+[^\n]*\n)*?)([ \t]+name:)[^\n]*/m, (_match, header, before, nameKey) => `${header}${before}${nameKey} ${name}`);
    if (updated === text)
      return;
    workspace.files[workspace.entry] = updated;
    if (workspace.active === workspace.entry) {
      source.value = updated;
      paint();
    }
  }
  function renameProject() {
    const name = prompt("Rename project", workspace.name);
    if (!name?.trim() || name.trim() === workspace.name)
      return;
    applyNameToYaml(name.trim());
    persist();
    const renamed = store.rename(workspace.id, name.trim());
    if (renamed)
      openProject(renamed);
  }
  function duplicateProject() {
    persist();
    const copy = store.duplicate(workspace.id);
    if (copy)
      openProject(copy);
  }
  function deleteProject() {
    if (!confirm(`Delete the project "${workspace.name}"? This cannot be undone.`))
      return;
    const next = store.remove(workspace.id);
    openProject(next ?? freshProject());
  }
  function freshProject() {
    return store.create("untitled", { "pulse.yaml": BLANK_MODEL }, "pulse.yaml");
  }
  function exportProject() {
    persist();
    const folder = safeFolderName(workspace.name);
    const entries = {};
    for (const [name, text] of Object.entries(workspace.files)) {
      entries[`${folder}/${name}`] = text;
    }
    download(`${folder}.zip`, zip(entries), "application/zip");
  }
  function generatePlatformioIni(project) {
    const board = project.target?.board ?? "";
    const BOARD_MAP = {
      esp32: ["espressif32", "esp32dev"],
      esp32s3: ["espressif32", "esp32-s3-devkitc-1"],
      esp32c3: ["espressif32", "esp32-c3-devkitm-1"],
      esp8266: ["espressif8266", "nodemcuv2"],
      uno: ["atmelavr", "uno"],
      mega: ["atmelavr", "megaatmega2560"],
      nano: ["atmelavr", "nanoatmega328"],
      nano33ble: ["nordicnrf52", "nano33ble"],
      rp2040: ["raspberrypi", "rpipico"],
      teensy41: ["teensy", "teensy41"]
    };
    const [platform, boardId] = BOARD_MAP[board] ?? ["# unknown platform", board || "# set board in target:"];
    const libs = project.system.libraries ?? [];
    const libDeps = libs.map((lib) => {
      if (lib.source === "git" && lib.url)
        return lib.url;
      if (lib.version)
        return `${lib.name}@${lib.version}`;
      return lib.name;
    });
    const libSection = libDeps.length > 0 ? `lib_deps =
${libDeps.map((l) => `    ${l}`).join("\n")}` : "# lib_deps =";
    return `[env:${boardId}]
platform = ${platform}
board     = ${boardId}
framework = arduino
${libSection}
`;
  }
  function safeFolderName(name) {
    const clean = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "");
    return clean || "model";
  }
  function importFiles(paths, fallbackName) {
    const { files, folder } = foldImport(paths);
    if (Object.keys(files).length === 0) {
      alert("No .yaml files in there. A PulseIR project is a folder of YAML models.");
      return;
    }
    const entry = findEntry(files);
    openProject(store.create(importedName(files, entry, folder, fallbackName), files, entry));
    if (!/^project:/m.test(files[entry])) {
      alert(`None of the imported files declares "project:", so "${entry}" was opened as the entry file. Use "Set entry" if that is the wrong one.`);
    }
  }
  async function importZipFile(file) {
    try {
      const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
      const decoder = new TextDecoder();
      const paths = {};
      for (const [name, bytes] of Object.entries(entries)) {
        paths[name] = decoder.decode(bytes);
      }
      importFiles(paths, file.name.replace(/\.zip$/i, ""));
    } catch (error) {
      alert(error instanceof ZipError ? error.message : `Could not read that zip: ${error}`);
    }
  }
  async function importFileList(list, fallbackName) {
    const files = [...list];
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      await importZipFile(files[0]);
      return;
    }
    const paths = {};
    for (const file of files) {
      const relative = file.webkitRelativePath;
      paths[relative || file.name] = await file.text();
    }
    importFiles(paths, fallbackName);
  }
  async function copyText(button, text) {
    const done = (ok2) => {
      const original = button.textContent;
      button.textContent = ok2 ? "Copied" : "Press Ctrl+C";
      button.classList.toggle("copied", ok2);
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove("copied");
      }, 1400);
    };
    try {
      await navigator.clipboard.writeText(text);
      done(true);
      return;
    } catch {
    }
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.append(scratch);
    scratch.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    scratch.remove();
    done(ok);
  }
  function visibleOutput() {
    if (!current)
      return "";
    const showing = Object.keys(panes).find((key) => !panes[key].hidden);
    switch (showing) {
      case "topics":
        return current.topics;
      case "libraries":
        return current.libraries;
      // The structure pane is a rendered table, so copy what it is derived from.
      case "structure":
        return panes.structure.innerText;
      default:
        return current.sketch;
    }
  }
  var SNIPPETS = [
    // ── Project ───────────────────────────────────────────────────────────────
    {
      group: "Project",
      label: "Import another file",
      yaml: `imports:
  - part.yaml`
    },
    // ── Serial ───────────────────────────────────────────────────────────────
    {
      group: "Serial",
      label: "Console (UART 0 \u2014 USB serial monitor)",
      yaml: `hardware:
  buses:
    console: { interface: uart, port: 0, baud: 115200 }

commands:
  source: console
  map:
    help: show_help`
    },
    {
      group: "Serial",
      label: "Extra UART (port 1)",
      yaml: `hardware:
  buses:
    uart1: { interface: uart, port: 1, baud: 9600 }`
    },
    // ── Protocol ─────────────────────────────────────────────────────────────
    {
      group: "Protocol",
      label: "I\xB2C bus",
      yaml: `hardware:
  buses:
    i2c_bus: { interface: i2c, sda: GPIO21, scl: GPIO22 }`
    },
    {
      group: "Protocol",
      label: "SPI bus",
      yaml: `hardware:
  buses:
    spi_bus: { interface: spi, sck: GPIO18, miso: GPIO19, mosi: GPIO23, cs: GPIO5 }`
    },
    {
      group: "Protocol",
      label: "Wi-Fi",
      yaml: `hardware:
  buses:
    wifi: { interface: wifi, ssid: "YourSSID" }`
    },
    {
      group: "Protocol",
      label: "MQTT (over Wi-Fi)",
      yaml: `hardware:
  buses:
    wifi: { interface: wifi, ssid: "YourSSID" }
    mqtt_bus: { interface: mqtt, host: "broker.example.com", port: 1883, prefix: "device" }`
    },
    // ── Device ───────────────────────────────────────────────────────────────
    {
      group: "Device",
      label: "Digital output  (LED, relay)",
      yaml: `hardware:
  devices:
    led: { type: digital_output, pin: GPIO2 }`
    },
    {
      group: "Device",
      label: "Digital input  (button, switch)",
      yaml: `hardware:
  devices:
    button: { type: digital_input, pin: GPIO0 }`
    },
    {
      group: "Device",
      label: "PWM output  (fan, motor, servo)",
      yaml: `hardware:
  devices:
    fan: { type: pwm_output, pin: GPIO27, channel: 0, frequency: 25000 }`
    },
    {
      group: "Device",
      label: "Analog input  (sensor, potentiometer)",
      yaml: `hardware:
  devices:
    sensor: { type: analog_input, pin: GPIO34, unit: V }`
    },
    // ── Logic ────────────────────────────────────────────────────────────────
    {
      group: "Logic",
      label: "Parameter  (tunable value)",
      yaml: `parameters:
  interval_ms: { type: int, default: 1000, range: [100, 60000], unit: ms }`
    },
    {
      group: "Logic",
      label: "Task  (repeating work)",
      yaml: `tasks:
  heartbeat:
    every: interval_ms
    do: my_action
    log: "running"
    description: Runs on a timer`
    },
    {
      group: "Logic",
      label: "Command table  (serial dispatch)",
      yaml: `commands:
  source: console
  map:
    on:   led_on
    off:  led_off
    help: show_help`
    },
    {
      group: "Logic",
      label: "State machine  (basic toggle)",
      yaml: `events:
  PRESS: { source: external }

machine:
  states:
    idle:
    active:
  transitions:
    - { from: idle,   on: PRESS, to: active }
    - { from: active, on: PRESS, to: idle }`
    }
  ];
  function insertSnippet(yaml2) {
    const text = source.value;
    const pos = source.selectionStart ?? text.length;
    const lineEnd = text.indexOf("\n", pos);
    const insertAt = lineEnd === -1 ? text.length : lineEnd + 1;
    const before = text.slice(0, insertAt);
    const after = text.slice(insertAt);
    const pad = (s) => s.length > 0 && !s.endsWith("\n\n") ? "\n" : "";
    const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const inserted = pad(before) + yaml2 + "\n" + suffix;
    source.value = before + inserted + after;
    paint();
    const newPos = insertAt + inserted.length;
    source.selectionStart = source.selectionEnd = newPos;
    workspace.files[workspace.active] = source.value;
  }
  function closeSnippetMenu() {
    snippetMenu.hidden = true;
    snippetButton.setAttribute("aria-expanded", "false");
  }
  function openSnippetMenu() {
    snippetMenu.replaceChildren();
    let lastGroup = "";
    for (const s of SNIPPETS) {
      if (s.group !== lastGroup) {
        if (lastGroup !== "")
          snippetMenu.append(separator());
        snippetMenu.append(heading(s.group));
        lastGroup = s.group;
      }
      snippetMenu.append(item(s.label, "", () => {
        closeSnippetMenu();
        insertSnippet(s.yaml);
        render();
        source.focus();
      }));
    }
    snippetMenu.hidden = false;
    snippetButton.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    projectMenu.hidden = true;
    projectButton.setAttribute("aria-expanded", "false");
  }
  function item(label, sub, run, extra = "") {
    const button = document.createElement("button");
    button.type = "button";
    if (extra)
      button.className = extra;
    button.innerHTML = `<span>${escapeHtml2(label)}</span>${sub ? `<span class="sub">${escapeHtml2(sub)}</span>` : ""}`;
    button.addEventListener("click", () => {
      closeMenu();
      run();
    });
    return button;
  }
  function separator() {
    const line = document.createElement("div");
    line.className = "sep";
    return line;
  }
  function heading(text) {
    const label = document.createElement("div");
    label.className = "heading";
    label.textContent = text;
    return label;
  }
  function openMenu() {
    persist();
    projectMenu.replaceChildren();
    projectMenu.append(item("New project\u2026", "", () => newProject()), item("Rename\u2026", "", renameProject), item("Duplicate", "", duplicateProject), separator(), item("Import folder\u2026", "", () => importFolderInput.click()), item("Import .zip\u2026", "", () => importZipInput.click()), item("Export as .zip", "", exportProject), separator());
    const projects = store.list();
    projectMenu.append(heading(projects.length > 1 ? "Recent projects" : "Projects"));
    for (const project of projects) {
      projectMenu.append(item(project.name, project.id === workspace.id ? "open" : `${Object.keys(project.files).length} file${Object.keys(project.files).length === 1 ? "" : "s"}`, () => {
        if (project.id !== workspace.id)
          openProject(project);
      }, project.id === workspace.id ? "current" : ""));
    }
    projectMenu.append(separator(), item("Delete this project", "", deleteProject, "danger"));
    projectMenu.hidden = false;
    projectButton.setAttribute("aria-expanded", "true");
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
    const showNs = name === "topics";
    namespaceInput.hidden = !showNs;
    namespaceLabel.hidden = !showNs;
    localStorage.setItem("pulseir.tab", name);
  }
  function init() {
    applyTheme(localStorage.getItem(THEME_KEY) ?? "auto");
    themeButton.addEventListener("click", cycleTheme);
    settingsButton.addEventListener("click", openSettings);
    $("settings-close").addEventListener("click", closeSettings);
    $("keyword-add-btn").addEventListener("click", addKeyword);
    keywordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter")
        addKeyword();
    });
    $("keyword-reset-btn").addEventListener("click", () => {
      activeKeywords = new Set(DEFAULT_KEYWORDS);
      saveKeywords();
      renderKeywordChips();
      paint();
    });
    settingsModal.addEventListener("click", (event) => {
      if (event.target === settingsModal)
        closeSettings();
    });
    for (const key of Object.keys(EXAMPLES)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key;
      exampleSelect.append(option);
    }
    openProject(restore());
    const rerender = debounce(render, 150);
    source.addEventListener("input", () => {
      const raw = source.value;
      const fixed = normalizeYaml(raw);
      if (fixed !== raw) {
        const ss = source.selectionStart ?? raw.length;
        const se = source.selectionEnd ?? raw.length;
        const shiftStart = normalizeYaml(raw.slice(0, ss)).length - ss;
        const shiftEnd = normalizeYaml(raw.slice(0, se)).length - se;
        source.value = fixed;
        source.setSelectionRange(ss + shiftStart, se + shiftEnd);
      }
      workspace.files[workspace.active] = source.value;
      paint();
      rerender();
    });
    source.addEventListener("scroll", syncScroll, { passive: true });
    namespaceInput.addEventListener("input", rerender);
    boardSelect.addEventListener("change", () => {
      applyBoardToYaml(boardSelect.value);
      rerender();
    });
    exampleSelect.addEventListener("change", () => {
      const label = exampleSelect.value;
      exampleSelect.value = "";
      if (EXAMPLES[label])
        newProject(label);
    });
    for (const button of document.querySelectorAll(".tab")) {
      button.addEventListener("click", () => selectTab(button.dataset.tab));
    }
    copyYamlButton.addEventListener("click", () => {
      void copyText(copyYamlButton, source.value);
    });
    copyOutputButton.addEventListener("click", () => {
      void copyText(copyOutputButton, visibleOutput());
    });
    $("add-file").addEventListener("click", addFile);
    $("set-entry").addEventListener("click", setEntry);
    function closeDownloadMenu() {
      downloadMenu.hidden = true;
      downloadButton.setAttribute("aria-expanded", "false");
    }
    downloadButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (downloadMenu.hidden) {
        downloadMenu.hidden = false;
        downloadButton.setAttribute("aria-expanded", "true");
      } else {
        closeDownloadMenu();
      }
    });
    $("download-sketch").addEventListener("click", () => {
      closeDownloadMenu();
      if (!current)
        return;
      download(`${current.project.name}.ino`, current.sketch, "text/plain");
    });
    $("download-topics").addEventListener("click", () => {
      closeDownloadMenu();
      if (!current)
        return;
      download("topics.json", current.topics, "application/json");
    });
    $("download-libraries").addEventListener("click", () => {
      closeDownloadMenu();
      if (!current)
        return;
      download("libraries.json", current.libraries, "application/json");
    });
    $("download-platformio").addEventListener("click", () => {
      closeDownloadMenu();
      if (!current)
        return;
      download("platformio.ini", generatePlatformioIni(current.project), "text/plain");
    });
    source.addEventListener("keydown", (event) => {
      const { selectionStart, selectionEnd, value } = source;
      if (event.key === "Tab") {
        event.preventDefault();
        if (selectionStart === selectionEnd) {
          source.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
          source.selectionStart = source.selectionEnd = selectionStart + 2;
        } else {
          const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
          const block = value.slice(lineStart, selectionEnd);
          const indented = block.replace(/^/gm, "  ");
          source.value = value.slice(0, lineStart) + indented + value.slice(selectionEnd);
          source.selectionStart = lineStart;
          source.selectionEnd = lineStart + indented.length;
        }
        workspace.files[workspace.active] = source.value;
        paint();
        rerender();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        if (selectionStart !== selectionEnd)
          return;
        const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
        const currentLine = value.slice(lineStart, selectionStart);
        const indent = /^[ \t]*/.exec(currentLine)[0];
        const deeper = /:\s*$/.test(currentLine);
        event.preventDefault();
        const insertion = "\n" + indent + (deeper ? "  " : "");
        source.value = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
        source.selectionStart = source.selectionEnd = selectionStart + insertion.length;
        workspace.files[workspace.active] = source.value;
        paint();
        rerender();
      }
    });
    projectButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (projectMenu.hidden)
        openMenu();
      else
        closeMenu();
    });
    snippetButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (snippetMenu.hidden)
        openSnippetMenu();
      else
        closeSnippetMenu();
    });
    document.addEventListener("click", (event) => {
      if (!projectMenu.hidden && !projectMenu.contains(event.target))
        closeMenu();
      if (!snippetMenu.hidden && !snippetMenu.contains(event.target))
        closeSnippetMenu();
      if (!downloadMenu.hidden && !downloadMenu.contains(event.target) && event.target !== downloadButton)
        closeDownloadMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !projectMenu.hidden)
        closeMenu();
      if (event.key === "Escape" && !snippetMenu.hidden)
        closeSnippetMenu();
      if (event.key === "Escape" && !downloadMenu.hidden)
        closeDownloadMenu();
      if (event.key === "Escape" && !settingsModal.hidden)
        closeSettings();
    });
    importZipInput.addEventListener("change", () => {
      const file = importZipInput.files?.[0];
      importZipInput.value = "";
      if (file)
        void importZipFile(file);
    });
    importFolderInput.addEventListener("change", () => {
      const files = importFolderInput.files;
      const picked = files ? [...files] : [];
      importFolderInput.value = "";
      if (picked.length)
        void importFileList(picked, "imported");
    });
    let dragDepth = 0;
    document.addEventListener("dragenter", (event) => {
      if (!event.dataTransfer?.types.includes("Files"))
        return;
      event.preventDefault();
      dragDepth++;
      document.body.classList.add("dropping");
    });
    document.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types.includes("Files"))
        event.preventDefault();
    });
    document.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0)
        document.body.classList.remove("dropping");
    });
    document.addEventListener("drop", (event) => {
      if (!event.dataTransfer?.files.length)
        return;
      event.preventDefault();
      dragDepth = 0;
      document.body.classList.remove("dropping");
      void importFileList(event.dataTransfer.files, "dropped");
    });
    selectTab(localStorage.getItem("pulseir.tab") || "sketch");
  }
  init();
})();
