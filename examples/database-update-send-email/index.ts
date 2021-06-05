// Find the official Notion API client @ https://  github.com/makenotion/notion-sdk-js/
// npm install @notionhq/client
import { Client, predicate } from "@notionhq/client"
import { DatabasesQueryResponse } from "@notionhq/client/build/src/api-endpoints"
import { Page } from "@notionhq/client/build/src/api-types"
import { MailDataRequired, send, setApiKey } from "@sendgrid/mail"
import { config } from "dotenv"

config()

setApiKey(process.env["SENDGRID_KEY"] || "")
const notion = new Client({ auth: process.env["NOTION_KEY"] })

const database_id = process.env["NOTION_DATABASE_ID"] || ""

async function findChangesAndSendEmails(tasksInDatabase: TasksInDatabase) {
  console.log("Looking for changes in Notion database ")
  // Get the tasks currently in the database
  const currTasksInDatabase = await getTasksFromDatabase()

  // Iterate over the current tasks and compare them to tasks in our local store (tasksInDatabase)
  for (const [key, value] of Object.entries(currTasksInDatabase)) {
    const page_id = key
    const curr_status = value.Status
    // If this task hasn't been seen before
    if (!(page_id in tasksInDatabase)) {
      // Add this task to the local store of all tasks
      tasksInDatabase[page_id] = {
        Status: curr_status,
      }
    } else {
      // If the current status is different from the status in the local store
      if (curr_status !== tasksInDatabase[page_id]?.Status) {
        // Change the local store.
        tasksInDatabase[page_id] = {
          Status: curr_status,
        }
        // Send an email about this change.
        const msg = {
          to: process.env["EMAIL_TO_FIELD"],
          from: process.env["EMAIL_FROM_FIELD"],
          subject: "Notion Task Status Updated",
          text:
            "A Notion task's: " +
            value.Title +
            " status has been updated to " +
            curr_status +
            ".",
        }
        send(msg as MailDataRequired)
          .then(() => {
            console.log("Email Sent")
          })
          .catch(error => {
            console.error(error)
          })
        console.log("Status Changed")
      }
    }
  }
  // Run this method every 5 seconds (5000 milliseconds)
  setTimeout(main, 5000)
}

async function main() {
  const tasksInDatabase = await getTasksFromDatabase()
  findChangesAndSendEmails(tasksInDatabase).catch(console.error)
}

type TasksInDatabase = Record<
  Page["id"],
  {
    Status?: string
    Title?: string
  }
>

// Get a paginated list of Tasks currently in a the database.
async function getTasksFromDatabase() {
  const tasks: TasksInDatabase = {}
  async function getPageOfTasks(cursor?: string | null) {
    let request_payload
    // Create the request payload based on the presence of a start_cursor
    if (cursor == undefined) {
      request_payload = {
        path: "databases/" + database_id + "/query",
        method: "POST",
      } as const
    } else {
      request_payload = {
        path: "databases/" + database_id + "/query",
        method: "POST",
        body: {
          start_cursor: cursor,
        },
      } as const
    }
    // While there are more pages left in the query, get pages from the database.
    const current_pages = await notion.request<DatabasesQueryResponse>(
      request_payload
    )

    for (const page of current_pages.results) {
      const { Name, Status } = page.properties
      // TS: Name is PropertyValue
      if (predicate.PropertyValue.isTitlePropertyValue(Name)) {
        // TS: Name is TitlePropertyValue
        const title = predicate.RichTextInput.isRichTextInputText(Name.title[0])
          ? Name.title[0]?.text.content
          : undefined

        const status = predicate.PropertyValue.isSelectPropertyValue(Status)
          ? Status.select.name
          : "No Status"

        tasks[page.id] = {
          Status: status,
          Title: title,
        }
      }
    }
    if (current_pages.has_more) {
      await getPageOfTasks(current_pages.next_cursor)
    }
  }
  await getPageOfTasks()
  return tasks
}

main()
