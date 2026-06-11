import {
  getAllRecipes,
  getRecipe,
  getRecipeByDeviceId,
  saveRecipe,
} from "../services/recipe.service.js";

export async function getRecipesController() {
  return getAllRecipes();
}

export async function getRecipeController(request, reply) {
  try {
    const { id } = request.params;
    return getRecipe(id);
  } catch (err) {
    return reply.code(404).send({
      error: err.message,
    });
  }
}

export async function getRecipeByDeviceController(request, reply) {
  try {
    const { deviceId } = request.params;
    const recipe = getRecipeByDeviceId(deviceId);
    if (!recipe) {
      return reply.code(404).send({
        error: "Recipe not found",
      });
    }
    return recipe;
  } catch (err) {
    return reply.code(400).send({
      error: err.message,
    });
  }
}

export async function createRecipeController(request) {
  const record = await saveRecipe(request.body);
  return {
    success: true,
    data: record,
  };
}
