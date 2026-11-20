"""The base for every model in the HTTP contract."""

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    # A field with a default is optional in a request but always present in a
    # response. Say so in the OpenAPI document, so the app's generated types
    # (apps/mobile/src/api/schema.ts) don't make it check for a value the API
    # always sends.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)
