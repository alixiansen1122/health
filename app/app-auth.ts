import { redirect } from "next/navigation";
import { getChatGPTUser, chatGPTSignInPath, type ChatGPTUser } from "./chatgpt-auth";

const localUser: ChatGPTUser = {
  userId: "local-preview-owner",
  email: "preview@health.local",
  displayName: "本地预览用户",
  fullName: "本地预览用户",
};

export async function getAppUser(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  if (user) return user;
  return process.env.NODE_ENV === "development" ? localUser : null;
}

export async function requireAppUser(returnTo = "/"): Promise<ChatGPTUser> {
  const user = await getAppUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}
