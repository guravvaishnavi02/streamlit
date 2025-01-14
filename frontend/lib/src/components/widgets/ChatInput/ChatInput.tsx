/**
 * Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2025)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, {
  ChangeEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react"

import axios from "axios"
import { useTheme } from "@emotion/react"
import { Send } from "@emotion-icons/material-rounded"
import { Textarea as UITextArea } from "baseui/textarea"
import { AttachFile } from "@emotion-icons/material-outlined"
import {
  ErrorCode as FileErrorCode,
  FileRejection,
  useDropzone,
} from "react-dropzone"
import zip from "lodash/zip"

import {
  AcceptFileValue,
  chatInputAcceptFileProtoValueToEnum,
  isNullOrUndefined,
} from "@streamlit/lib/src/util/utils"
import {
  ChatInput as ChatInputProto,
  FileUploaderState as FileUploaderStateProto,
  FileURLs as FileURLsProto,
  IChatInputValue,
  IFileURLs,
  UploadedFileInfo as UploadedFileInfoProto,
} from "@streamlit/lib/src/proto"
import {
  WidgetInfo,
  WidgetStateManager,
} from "@streamlit/lib/src/WidgetStateManager"
import Icon from "@streamlit/lib/src/components/shared/Icon"
import InputInstructions from "@streamlit/lib/src/components/shared/InputInstructions/InputInstructions"
import { isEnterKeyPressed } from "@streamlit/lib/src/util/inputUtils"
import BaseButton, {
  BaseButtonKind,
} from "@streamlit/lib/src/components/shared/BaseButton"
import {
  UploadedStatus,
  UploadFileInfo,
} from "@streamlit/lib/src/components/widgets/FileUploader/UploadFileInfo"
import { FileUploadClient } from "@streamlit/lib/src/FileUploadClient"
import UploadedFiles from "@streamlit/lib/src/components/widgets/FileUploader/UploadedFiles"

import {
  StyledChatInput,
  StyledChatInputContainer,
  StyledInputInstructionsContainer,
  StyledSendIconButton,
  StyledSendIconButtonContainer,
  StyledVerticalDivider,
} from "./styled-components"
import { fi } from "date-fns/locale"

export interface Props {
  disabled: boolean
  element: ChatInputProto
  widgetMgr: WidgetStateManager
  width: number
  uploadClient: FileUploadClient
  fragmentId?: string
}

interface CreateDropHandlerParams {
  acceptMultipleFiles: boolean
  uploadClient: FileUploadClient
  uploadFile: (fileURLs: FileURLsProto, file: File) => void
  addFiles: (files: UploadFileInfo[]) => void
  getNextLocalFileId: () => number
  deleteExistingFiles: () => void
  onUploadComplete: () => void
}

const createDropHandler =
  ({
    acceptMultipleFiles,
    uploadClient,
    uploadFile,
    addFiles,
    getNextLocalFileId,
    deleteExistingFiles,
    onUploadComplete,
  }: CreateDropHandlerParams) =>
  (acceptedFiles: File[], rejectedFiles: FileRejection[]): void => {
    // If only single file upload is allowed but multiple were dropped/selected,
    // all files will be rejected by default. In this case, we take the first
    // valid file into acceptedFiles, and reject the rest.
    if (
      !acceptMultipleFiles &&
      acceptedFiles.length === 0 &&
      rejectedFiles.length > 1
    ) {
      const firstFileIndex = rejectedFiles.findIndex(
        file => file.errors?.[0].code === FileErrorCode.TooManyFiles
      )

      if (firstFileIndex >= 0) {
        acceptedFiles.push(rejectedFiles[firstFileIndex].file)
        rejectedFiles.splice(firstFileIndex, 1)
      }
    }

    if (!acceptMultipleFiles && acceptedFiles.length > 0) {
      deleteExistingFiles()
    }

    uploadClient
      .fetchFileURLs(acceptedFiles)
      .then((fileURLsArray: IFileURLs[]) => {
        zip(fileURLsArray, acceptedFiles).forEach(
          ([fileURLs, acceptedFile]) => {
            uploadFile(fileURLs as FileURLsProto, acceptedFile as File)
          }
        )
      })
      .catch((errorMessage: string) => {
        addFiles(
          acceptedFiles.map(f => {
            return new UploadFileInfo(f.name, f.size, getNextLocalFileId(), {
              type: "error",
              errorMessage,
            })
          })
        )
      })

    // Create an UploadFileInfo for each of our rejected files, and add them to
    // our state.
    if (rejectedFiles.length > 0) {
      const rejectedInfos = rejectedFiles.map(rejected => {
        const { file } = rejected
        return new UploadFileInfo(file.name, file.size, getNextLocalFileId(), {
          type: "error",
          errorMessage: rejected.errors
            .map(err => err.message)
            .filter(err => err !== "")
            .join(", "),
        })
      })
      addFiles(rejectedInfos)
    }

    onUploadComplete()
  }

interface CreateUploadFileParams {
  getNextLocalFileId: () => number
  addFiles: (files: UploadFileInfo[]) => void
  updateFile: (id: number, fileInfo: UploadFileInfo) => void
  uploadClient: FileUploadClient
  element: WidgetInfo
  onUploadProgress: (e: ProgressEvent, id: number) => void
  onUploadComplete: (id: number, fileURLs: IFileURLs) => void
}

const createUploadFileHandler =
  ({
    getNextLocalFileId,
    addFiles,
    updateFile,
    uploadClient,
    element,
    onUploadProgress,
    onUploadComplete,
  }: CreateUploadFileParams) =>
  (fileURLs: IFileURLs, file: File): void => {
    // Create an UploadFileInfo for this file and add it to our state.
    const cancelToken = axios.CancelToken.source()
    const uploadingFileInfo = new UploadFileInfo(
      file.name,
      file.size,
      getNextLocalFileId(),
      {
        type: "uploading",
        cancelToken,
        progress: 1,
      }
    )
    addFiles([uploadingFileInfo])

    uploadClient
      .uploadFile(
        {
          formId: "", // TODO[kajarnec] fix this probably with uploadFile refactoring
          ...element,
        },
        fileURLs.uploadUrl as string,
        file,
        e => onUploadProgress(e, uploadingFileInfo.id),
        cancelToken.token
      )
      .then(() => onUploadComplete(uploadingFileInfo.id, fileURLs))
      .catch(err => {
        // If this was a cancel error, we don't show the user an error -
        // the cancellation was in response to an action they took.
        if (!axios.isCancel(err)) {
          updateFile(
            uploadingFileInfo.id,
            uploadingFileInfo.setStatus({
              type: "error",
              errorMessage: err ? err.toString() : "Unknown error",
            })
          )
        }
      })
  }

// We want to show easily that there's scrolling so we deliberately choose
// a half size.
const MAX_VISIBLE_NUM_LINES = 6.5
// Rounding errors can arbitrarily create scrollbars. We add a rounding offset
// to manage it better.
const ROUNDING_OFFSET = 1

interface UploadZoneProps {
  acceptFile: AcceptFileValue
  fileDragged: boolean
  getRootProps: any
  getInputProps: any
  disabled: boolean
}

const UploadZone = ({
  acceptFile,
  fileDragged,
  getRootProps,
  getInputProps,
  disabled,
}: UploadZoneProps) =>
  fileDragged ? (
    <div
      {...getRootProps()}
      style={{
        width: "100%",
        border: "2px dashed #cccccc",
        padding: "20px",
        textAlign: "center",
      }}
    >
      <input {...getInputProps()} />
      <p>Drag 'n' drop some files here, or click to select files</p>
    </div>
  ) : (
    <>
      <div {...getRootProps()}>
        <input {...getInputProps()} />
        <BaseButton
          kind={BaseButtonKind.BORDERLESS_ICON}
          onClick={() => {}}
          disabled={disabled}
        >
          <Icon content={AttachFile} size="base" color="inherit" />
        </BaseButton>
      </div>
      <StyledVerticalDivider />
    </>
  )

function ChatInput({
  width,
  element,
  widgetMgr,
  fragmentId,
  uploadClient,
}: Props): React.ReactElement {
  const theme = useTheme()

  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const counterRef = useRef(0)
  const heightGuidance = useRef({ minHeight: 0, maxHeight: 0 })

  // True if the user-specified state.value has not yet been synced to the WidgetStateManager.
  const [dirty, setDirty] = useState(false)
  // The value specified by the user via the UI. If the user didn't touch this widget's UI, the default value is used.
  const [value, setValue] = useState(element.default)
  // The value of the height of the textarea. It depends on a variety of factors including the default height, and autogrowing
  const [scrollHeight, setScrollHeight] = useState(0)
  const [files, setFiles] = useState<UploadFileInfo[]>([])

  const [placeholder, setPlaceholder] = useState(element.placeholder)
  const [fileDragged, setFileDragged] = useState(false)

  const acceptFile = chatInputAcceptFileProtoValueToEnum(element.acceptFile)
  const addFiles = (filesToAdd: UploadFileInfo[]): void => {
    setFiles(currentFiles => [...currentFiles, ...filesToAdd])
  }

  const isDirty = (value: string, files: UploadFileInfo[]): boolean => {
    // TODO [kajarnec] add explanatory comment here.
    if (files.some(f => f.status.type === "uploading")) {
      return false
    }
    return value !== "" || files.length > 0
  }

  const updateFile = (
    id: number,
    fileInfo: UploadFileInfo,
    currentFiles: UploadFileInfo[]
  ): UploadFileInfo[] => currentFiles.map(f => (f.id === id ? fileInfo : f))

  const getFile = (
    localFileId: number,
    currentFiles: UploadFileInfo[]
  ): UploadFileInfo | undefined => currentFiles.find(f => f.id === localFileId)

  const deleteFile = (fileId: number): void => {
    setFiles(files => {
      const file = getFile(fileId, files)
      if (isNullOrUndefined(file)) {
        return files
      }

      if (file.status.type === "uploading") {
        // Cancel request as the file hasn't been uploaded.
        // However, it may have been received by the server so we'd still
        // send out a request to delete it.
        file.status.cancelToken.cancel()
      }

      if (file.status.type === "uploaded" && file.status.fileUrls.deleteUrl) {
        uploadClient.deleteFile(file.status.fileUrls.deleteUrl)
      }

      return files.filter(file => file.id !== fileId)
    })
  }

  const createChatInputWidgetFilesValue = (): FileUploaderStateProto => {
    const uploadedFileInfo: UploadedFileInfoProto[] = files
      .filter(f => f.status.type === "uploaded")
      .map(f => {
        const { name, size, status } = f
        const { fileId, fileUrls } = status as UploadedStatus
        return new UploadedFileInfoProto({
          fileId,
          fileUrls,
          name,
          size,
        })
      })

    return new FileUploaderStateProto({ uploadedFileInfo })
  }

  const getNextLocalFileId = (): number => {
    return counterRef.current++
  }

  const dropHandler = createDropHandler({
    acceptMultipleFiles: acceptFile === AcceptFileValue.Multiple,
    uploadClient: uploadClient,
    uploadFile: createUploadFileHandler({
      getNextLocalFileId,
      addFiles,
      updateFile: (id, fileInfo) => {
        setFiles(files => updateFile(id, fileInfo, files))
      },
      uploadClient,
      element,
      onUploadProgress: (e, fileId) => {
        setFiles(files => {
          const file = getFile(fileId, files)
          if (isNullOrUndefined(file) || file.status.type !== "uploading") {
            return files
          }

          const newProgress = Math.round((e.loaded * 100) / e.total)
          if (file.status.progress === newProgress) {
            return files
          }

          return updateFile(
            fileId,
            file.setStatus({
              type: "uploading",
              cancelToken: file.status.cancelToken,
              progress: newProgress,
            }),
            files
          )
        })
      },
      onUploadComplete: (id, fileUrls) => {
        setFiles(files => {
          const curFile = getFile(id, files)
          if (
            isNullOrUndefined(curFile) ||
            curFile.status.type !== "uploading"
          ) {
            // The file may have been canceled right before the upload
            // completed. In this case, we just bail.
            return files
          }

          return updateFile(
            curFile.id,
            curFile.setStatus({
              type: "uploaded",
              fileId: fileUrls.fileId as string,
              fileUrls,
            }),
            files
          )
        })
      },
    }),
    addFiles,
    getNextLocalFileId,
    deleteExistingFiles: () => files.forEach(f => deleteFile(f.id)),
    onUploadComplete: () => {
      if (chatInputRef.current) {
        chatInputRef.current.focus()
      }
    },
  })

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: dropHandler,
    multiple: acceptFile === AcceptFileValue.Multiple,
    accept: element.fileType.length > 0 ? element.fileType : undefined,
  })

  const getScrollHeight = (): number => {
    let scrollHeight = 0
    const { current: textarea } = chatInputRef
    if (textarea) {
      const placeholder = textarea.placeholder
      textarea.placeholder = ""
      textarea.style.height = "auto"
      scrollHeight = textarea.scrollHeight
      textarea.placeholder = placeholder
      textarea.style.height = ""
    }

    return scrollHeight
  }

  const getTextAreaBorderStyle = (): React.CSSProperties =>
    acceptFile !== AcceptFileValue.None
      ? { border: "none" }
      : {
          borderRadius: theme.radii.xxxl,
          // Baseweb requires long-hand props, short-hand leads to weird bugs & warnings.
          borderLeftWidth: theme.sizes.borderWidth,
          borderRightWidth: theme.sizes.borderWidth,
          borderTopWidth: theme.sizes.borderWidth,
          borderBottomWidth: theme.sizes.borderWidth,
        }

  const handleSubmit = (): void => {
    // We want the chat input to always be in focus
    // even if the user clicks the submit button
    if (chatInputRef.current) {
      chatInputRef.current.focus()
    }

    if (!dirty || element.disabled) {
      return
    }

    const composedValue: IChatInputValue = {
      data: value,
      fileUploaderState: createChatInputWidgetFilesValue(),
    }

    widgetMgr.setChatInputValue(
      element,
      composedValue,
      { fromUi: true },
      fragmentId
    )
    setDirty(false)
    setFiles([])
    setValue("")
    setScrollHeight(0)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const { metaKey, ctrlKey, shiftKey } = e
    const shouldSubmit =
      isEnterKeyPressed(e) && !shiftKey && !ctrlKey && !metaKey

    if (shouldSubmit) {
      e.preventDefault()

      handleSubmit()
    }
  }

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const { value } = e.target
    const { maxChars } = element

    if (maxChars !== 0 && value.length > maxChars) {
      return
    }

    setDirty(isDirty(value, files))
    setValue(value)
    setScrollHeight(getScrollHeight())
  }

  useEffect(() => {
    if (element.setValue) {
      // We are intentionally setting this to avoid regularly calling this effect.
      // TODO: Update to match React best practices
      // eslint-disable-next-line react-compiler/react-compiler
      element.setValue = false
      const val = element.value || ""
      setValue(val)
      setDirty(isDirty(val, files))
    }
  }, [element, files])

  useEffect(() => {
    setDirty(isDirty(value, files))
  }, [files, value])

  useEffect(() => {
    if (chatInputRef.current) {
      const { offsetHeight } = chatInputRef.current
      heightGuidance.current.minHeight = offsetHeight
      heightGuidance.current.maxHeight = offsetHeight * MAX_VISIBLE_NUM_LINES
    }
  }, [chatInputRef])

  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      event.preventDefault()
      if (!fileDragged) {
        console.log("hello file")
        setFileDragged(true)
        setPlaceholder("Drop file here")
      }
    }

    const handleDragLeave = () => {
      if (fileDragged) {
        setFileDragged(false)
        setPlaceholder(element.placeholder)
      }
    }

    const handleDrop = (event: DragEvent) => {
      event.preventDefault()
      handleDragLeave()
    }

    window.addEventListener("dragover", handleDragOver)
    window.addEventListener("drop", handleDrop)
    window.addEventListener("dragleave", handleDragLeave)
    return () => {
      window.removeEventListener("dragover", handleDragOver)
      window.removeEventListener("drop", handleDrop)
      window.removeEventListener("dragleave", handleDragLeave)
    }
  }, [fileDragged])

  const { disabled, maxChars } = element
  const { minHeight, maxHeight } = heightGuidance.current

  const isInputExtended =
    scrollHeight > 0 && chatInputRef.current
      ? Math.abs(scrollHeight - minHeight) > ROUNDING_OFFSET
      : false

  const showDropZone = acceptFile !== AcceptFileValue.None && fileDragged

  return (
    <>
      {files.length > 0 && (
        <UploadedFiles
          items={[...files]}
          pageSize={1}
          onDelete={deleteFile}
          surface="chat"
          resetOnAdd
          style={{
            paddingLeft: 0,
            paddingRight: 0,
          }}
        />
      )}
      <StyledChatInputContainer
        className="stChatInput"
        data-testid="stChatInput"
        width={width}
        height={height}
      >
        <StyledChatInput>
          {acceptFile === AcceptFileValue.None ? null : (
            <UploadZone
              acceptFile={acceptFile}
              fileDragged={fileDragged}
              getRootProps={getRootProps}
              getInputProps={getInputProps}
              disabled={disabled}
            />
          )}
          {showDropZone ? null : (
            <>
              <UITextArea
                inputRef={chatInputRef}
                value={value}
                placeholder={placeholder}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                aria-label={placeholder}
                disabled={disabled}
                rows={1}
                overrides={{
                  Root: {
                    style: {
                      minHeight: theme.sizes.minElementHeight,
                      outline: "none",
                      backgroundColor: theme.colors.transparent,
                      ...getTextAreaBorderStyle(),
                    },
                  },
                  InputContainer: {
                    style: {
                      backgroundColor: theme.colors.transparent,
                    },
                  },
                  Input: {
                    props: {
                      "data-testid": "stChatInputTextArea",
                    },
                    style: {
                      lineHeight: theme.lineHeights.inputWidget,
                      backgroundColor: theme.colors.transparent,
                      "::placeholder": {
                        opacity: "0.7",
                      },
                      height: isInputExtended
                        ? `${scrollHeight + ROUNDING_OFFSET}px`
                        : "auto",
                      maxHeight: maxHeight ? `${maxHeight}px` : "none",
                      // Baseweb requires long-hand props, short-hand leads to weird bugs & warnings.
                      paddingLeft: theme.spacing.sm,
                      paddingBottom: theme.spacing.sm,
                      paddingTop: theme.spacing.sm,
                      // Calculate the right padding to account for the send icon (iconSizes.xl + 2 * spacing.sm)
                      // and some additional margin between the icon and the text (spacing.sm).
                      paddingRight: `calc(${theme.iconSizes.xl} + 2 * ${theme.spacing.sm} + ${theme.spacing.sm})`,
                    },
                  },
                }}
              />
              {/* Hide the character limit in small widget sizes */}
              {width > theme.breakpoints.hideWidgetDetails && (
                <StyledInputInstructionsContainer>
                  <InputInstructions
                    dirty={dirty}
                    value={value}
                    maxLength={maxChars}
                    type="chat"
                    // Chat Input are not able to be used in forms
                    inForm={false}
                  />
                </StyledInputInstructionsContainer>
              )}
              <StyledSendIconButtonContainer>
                <StyledSendIconButton
                  onClick={handleSubmit}
                  disabled={!dirty || disabled}
                  extended={isInputExtended}
                  data-testid="stChatInputSubmitButton"
                >
                  <Icon content={Send} size="xl" color="inherit" />
                </StyledSendIconButton>
              </StyledSendIconButtonContainer>
            </>
          )}
        </StyledChatInput>
      </StyledChatInputContainer>
    </>
  )
}

export default ChatInput
