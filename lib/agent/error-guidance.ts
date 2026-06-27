export type ErrorGuidance = {
  title: string;
  message: string;
  suggestions: string[];
};

const SUPPORTED_TEMPLATE_TEXT = "Supported templates: mounting_plate and l_bracket.";

const EXAMPLE_PROMPTS = [
  "Make a 120 x 80 x 4 mm mounting plate with four 4.5 mm holes.",
  "Create a 90 x 60 x 40 mm L bracket, 5 mm thick, with 5 mm holes.",
];

export function errorGuidanceForCode(errorCode?: string, fallbackMessage?: string): ErrorGuidance {
  switch (errorCode) {
    case "UNSUPPORTED_PART_TYPE":
      return {
        title: "Template not supported yet",
        message: `${SUPPORTED_TEMPLATE_TEXT} No placeholder CAD was generated.`,
        suggestions: EXAMPLE_PROMPTS,
      };
    case "PARAMETER_CONFLICT":
      return {
        title: "Dimensions need adjustment",
        message: "The requested dimensions conflict with this template's CAD constraints.",
        suggestions: ["Reduce edgeOffset.", "Increase the plate or bracket dimensions.", "Reduce the hole diameter."],
      };
    case "RATE_LIMITED":
      return {
        title: "Please wait before retrying",
        message: "The staging runner is protecting CAD concurrency and model usage.",
        suggestions: ["Wait about a minute, then send the request again."],
      };
    case "LLM_JSON_ERROR":
    case "CAD_RUNNER_CRASH":
      return {
        title: "Run could not complete",
        message: "Please retry once or contact the staging administrator with the revision or run context.",
        suggestions: [],
      };
    case "VALIDATION_FAILED":
      return {
        title: "Geometry validation failed",
        message: "The model was generated but did not pass validation.",
        suggestions: ["Try less aggressive dimensions.", "Report the revision for triage."],
      };
    default:
      return {
        title: "Request needs attention",
        message: fallbackMessage || "The CAD agent could not complete this request. Try again or report the run.",
        suggestions: [],
      };
  }
}
