// POST /api/comments/delete: the author marks their own comment deleted (the row is kept).
import * as db from "../_lib/db.js";
import {handleDeleteComment} from "../_lib/social.js";
import {socialDeps, socialPost} from "../_lib/socialApi.js";

const post = socialPost("comments/delete", async (body) => handleDeleteComment(body, socialDeps(db.getSql())));
export const POST = post.POST;
export const OPTIONS = post.OPTIONS;
