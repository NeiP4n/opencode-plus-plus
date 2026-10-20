import { Orchestra } from "@opencode/core/orchestra"
import { Dod } from "@opencode/core/dod"
import { Federation } from "@opencode/core/federation"
import { Session } from "@opencode/core/session"
import { InvalidRequestError, ProjectNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { missingSession } from "./session-error"

function missingProject(error: Orchestra.ProjectNotFoundError) {
  return Effect.fail(
    new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` }),
  )
}

function badTemplate(error: Orchestra.TemplateNotFoundError) {
  return Effect.fail(
    new InvalidRequestError({ message: `Unknown team template: ${error.template}`, field: "template" }),
  )
}

function badDirectory(error: Orchestra.DirectoryError) {
  return Effect.fail(
    new InvalidRequestError({ message: `Not an existing directory: ${error.directory}`, field: "directory" }),
  )
}

function badSandbox(error: Orchestra.SandboxError) {
  return Effect.fail(new InvalidRequestError({ message: error.message, field: error.reason }))
}

function badProjectMove(error: Orchestra.ProjectMoveError) {
  return Effect.fail(new InvalidRequestError({ message: error.message, field: "directory" }))
}

function badTeam(error: Orchestra.TeamError) {
  return Effect.fail(new InvalidRequestError({ message: error.message, field: error.field }))
}

function badDod(error: Dod.DodError) {
  return Effect.fail(new InvalidRequestError({ message: error.message }))
}

export const OrchestraHandler = HttpApiBuilder.group(Api, "server.orchestra", (handlers) =>
  Effect.gen(function* () {
    const orchestra = yield* Orchestra.Service
    const federation = yield* Federation.Service
    const sessions = yield* Session.Service

    return handlers
      .handle("orchestra.project.list", () => orchestra.projects())
      .handle("orchestra.group.list", () => federation.groups())
      .handle("orchestra.group.save", (ctx) =>
        federation.setGroup(ctx.payload).pipe(
          Effect.as(HttpApiSchema.NoContent.make()),
          Effect.catchTag("Federation.Error", (error) => Effect.fail(new InvalidRequestError({ message: error.message }))),
        ),
      )
      .handle(
        "orchestra.group.remove",
        Effect.fn(function* (ctx) {
          yield* federation.removeGroup(ctx.params.name)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.group.link", (ctx) =>
        federation.linkGroup(ctx.params.name).pipe(
          Effect.map((pairs) => ({ pairs })),
          Effect.catchTag("Federation.Error", (error) => Effect.fail(new InvalidRequestError({ message: error.message }))),
        ),
      )
      .handle(
        "orchestra.group.chat",
        Effect.fn(function* (ctx) {
          const group = (yield* federation.groups()).find((item) => item.name === ctx.params.name.trim())
          if (!group)
            return yield* new InvalidRequestError({ message: `No group named ${ctx.params.name}`, field: "name" })
          // The chat follows the group's saved mode. Changing the mode is the group dialog's job,
          // because it drops the chat of the old mode.
          const mode = Federation.modeOf(group)
          if (ctx.payload.mode && ctx.payload.mode !== mode)
            return yield* new InvalidRequestError({
              message: `Group "${group.name}" is in ${mode} mode. Change the mode in the group dialog first.`,
              field: "mode",
            })
          return yield* federation
            .ensureGroupChat({ name: group.name, projects: group.projects, mode })
            .pipe(
              Effect.catchTag("Federation.Error", (error) => Effect.fail(new InvalidRequestError({ message: error.message }))),
            )
        }),
      )
      .handle(
        "orchestra.link.set",
        Effect.fn(function* (ctx) {
          if (ctx.payload.linked)
            yield* federation
              .link(ctx.payload.a, ctx.payload.b)
              .pipe(Effect.catchTag("Federation.Error", (error) => Effect.fail(new InvalidRequestError({ message: error.message }))))
          else yield* federation.unlink(ctx.payload.a, ctx.payload.b)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.link.list", (ctx) => federation.linked(ctx.params.projectID))
      .handle("orchestra.template.list", () => orchestra.templates())
      .handle("orchestra.template.create", (ctx) =>
        orchestra.saveTemplate(undefined, ctx.payload).pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle("orchestra.template.update", (ctx) =>
        orchestra
          .saveTemplate(ctx.params.templateID, ctx.payload)
          .pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle(
        "orchestra.template.remove",
        Effect.fn(function* (ctx) {
          yield* orchestra.removeTemplate(ctx.params.templateID).pipe(Effect.catchTag("Orchestra.TeamError", badTeam))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.role.list", () => orchestra.roles())
      .handle("orchestra.role.create", (ctx) =>
        orchestra.saveRole(undefined, ctx.payload).pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle("orchestra.role.update", (ctx) =>
        orchestra.saveRole(ctx.params.roleID, ctx.payload).pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle(
        "orchestra.role.remove",
        Effect.fn(function* (ctx) {
          yield* orchestra.removeRole(ctx.params.roleID).pipe(Effect.catchTag("Orchestra.TeamError", badTeam))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.project.create", (ctx) =>
        orchestra
          .create(ctx.payload)
          .pipe(
            // A concurrently removed project is an invalid creation state, not the
            // project-detail 404 response used by the separate main/session routes.
            Effect.catchTag(
              "Orchestra.ProjectNotFoundError",
              (error) =>
                Effect.fail(
                  new InvalidRequestError({ message: `Project disappeared during creation: ${error.projectID}` }),
                ),
            ),
            Effect.catchTag("Orchestra.DirectoryError", badDirectory),
            Effect.catchTag("Orchestra.TemplateNotFoundError", badTemplate),
            Effect.catchTag("Orchestra.SandboxError", badSandbox),
            Effect.catchTag("Dod.Error", badDod),
          ),
      )
      .handle("orchestra.project.update", (ctx) =>
        orchestra
          .update(ctx.params.projectID, ctx.payload)
          .pipe(
            Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject),
            Effect.catchTag("Orchestra.DirectoryError", badDirectory),
            Effect.catchTag("Orchestra.ProjectMoveError", badProjectMove),
            Effect.catchTag("Dod.Error", badDod),
          ),
      )
      .handle(
        "orchestra.project.remove",
        Effect.fn(function* (ctx) {
          yield* orchestra
            .remove(ctx.params.projectID)
            .pipe(Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.project.main", (ctx) =>
        orchestra
          .main(ctx.params.projectID)
          .pipe(
            Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject),
            Effect.catchTag("Orchestra.ProjectMoveError", badProjectMove),
            Effect.catchTag("Dod.Error", badDod),
          ),
      )
      .handle(
        "orchestra.project.sessions",
        Effect.fn(function* (ctx) {
          const data = yield* orchestra.sessions(ctx.params.projectID).pipe(
            Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject),
            Effect.catchTag("Orchestra.ProjectMoveError", badProjectMove),
            Effect.catchTag("Dod.Error", badDod),
          )
          const ids = data.map((session) => session.id)
          return { data, access: yield* orchestra.accessMany(ids), category: yield* orchestra.categories(ids) }
        }),
      )
      .handle("orchestra.owner.list", () => orchestra.owners())
      .handle(
        "orchestra.owner.set",
        Effect.fn(function* (ctx) {
          yield* sessions.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          yield* orchestra
            .claim(ctx.params.sessionID, ctx.payload.projectID)
            .pipe(
              Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject),
              Effect.catchTag("Orchestra.ProjectMoveError", badProjectMove),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "orchestra.category",
        Effect.fn(function* (ctx) {
          yield* sessions.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          yield* orchestra.setCategory(ctx.params.sessionID, ctx.payload.category)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "orchestra.access",
        Effect.fn(function* (ctx) {
          yield* sessions.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          yield* orchestra.setAccess(ctx.params.sessionID, ctx.payload.access)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
