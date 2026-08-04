// A DataHub dataset URN, e.g.:
//   urn:li:dataset:(urn:li:dataPlatform:dbt,mydb.model,PROD)
//
// Replaces raw template-string interpolation scattered across datahub/client.js.
// The format is defined once here; future code that needs to parse a URN back
// into its parts has a single place to add that logic.
class DatasetUrn {
  constructor(platform, datasetName, env) {
    this.platform = platform;
    this.datasetName = datasetName;
    this.env = env;
  }

  // Build a URN for a dbt model name using the runtime config.
  // Prepends datasetPrefix when one is configured.
  static forModel(modelName, { platform, env, datasetPrefix }) {
    const datasetName = datasetPrefix ? `${datasetPrefix}.${modelName}` : modelName;
    return new DatasetUrn(platform, datasetName, env);
  }

  toString() {
    return `urn:li:dataset:(urn:li:dataPlatform:${this.platform},${this.datasetName},${this.env})`;
  }
}

module.exports = { DatasetUrn };
