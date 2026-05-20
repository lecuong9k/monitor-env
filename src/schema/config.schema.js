export const createConfigSchema = {
    body: {
        type: "object",
        required: ["key", "value"],
        properties: {
            key: {
                type: "string"
            },
            value: {
                type: "string"
            }
        }
    }
};