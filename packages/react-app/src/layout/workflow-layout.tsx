import { XStream } from '@ant-design/x'
import {
	DifyApi,
	EventEnum,
	IAgentMessage,
	IErrorEvent,
	IMessageFileItem,
	IWorkflowNode,
} from '@dify-chat/api'
import {
	AppInfo,
	AppInputForm,
	LucideIcon,
	MarkdownRenderer,
	MessageFileList,
	WorkflowLogs,
} from '@dify-chat/components'
import { AppModeEnums, useAppContext } from '@dify-chat/core'
import { copyToClipboard } from '@toolkit-fe/clipboard'
import { Button, Empty, Form, message, Tabs } from 'antd'
import React from 'react'
import { useState } from 'react'

interface IWorkflowLayoutProps {
	difyApi: DifyApi
}

type WorkflowParsedData = {
	event?: string
	data?: {
		outputs?: Record<string, string>
		files?: Partial<IMessageFileItem>[]
		id?: string
		node_type?: string
		title?: string
		inputs?: unknown
		process_data?: unknown
		elapsed_time?: unknown
		execution_metadata?: unknown
		text?: string
	}
	answer?: string
	url?: string
}

/**
 * 工作流应用详情布局
 */
export default function WorkflowLayout(props: IWorkflowLayoutProps) {
	const { difyApi } = props
	const [entryForm] = Form.useForm()
	const { currentApp } = useAppContext()
	const [text, setText] = useState('')
	const [workflowStatus, setWorkflowStatus] = useState<'running' | 'finished'>()
	const [workflowItems, setWorkflowItems] = useState<IWorkflowNode[]>([])
	const [resultDetail, setResultDetail] = useState<Record<string, string>>({})
	const [files, setFiles] = useState<Partial<IMessageFileItem>[]>([])

	const handleTriggerWorkflow = async (values: Record<string, unknown>) => {
		const runner = () => {
			const appMode = currentApp?.config?.info?.mode
			if (appMode === AppModeEnums.WORKFLOW) {
				return difyApi.runWorkflow({
					inputs: values,
				})
			} else if (appMode === AppModeEnums.TEXT_GENERATOR) {
				return difyApi.completion({
					inputs: values,
				})
			}
			return Promise.reject(`不支持的应用类型: ${appMode}`)
		}

		runner()
			.then(async res => {
				const readableStream = XStream({
					readableStream: res.body as NonNullable<ReadableStream>,
				})
				const reader = readableStream.getReader()
				let result = ''
				const workflows: IAgentMessage['workflows'] = {}
				while (reader) {
					const { value: chunk, done } = await reader.read()
					if (done) {
						setWorkflowStatus('finished')
						break
					}
					if (!chunk) continue
					if (chunk.data) {
						let parsedData: WorkflowParsedData = {}
						try {
							parsedData = JSON.parse(chunk.data)
						} catch (error) {
							console.error('解析 JSON 失败', error)
						}

						if (
							parsedData.event === 'text_chunk' &&
							parsedData.data &&
							typeof (parsedData.data as { text?: string }).text === 'string'
						) {
							setText(prev => prev + (parsedData.data as { text: string }).text)
						}

						if (parsedData.event === EventEnum.WORKFLOW_STARTED) {
							workflows.status = 'running'
							workflows.nodes = []
							setWorkflowStatus('running')
							setWorkflowItems([])
						} else if (parsedData.event === EventEnum.WORKFLOW_FINISHED) {
							workflows.status = 'finished'
							const outputs = parsedData.data?.outputs
							const resultFiles = parsedData.data?.files
							const outputsLength = outputs ? Object.keys(outputs)?.length : 0
							if (outputsLength > 0 && outputs) {
								setResultDetail(outputs)
							}
							if (resultFiles && Array.isArray(resultFiles) && resultFiles.length > 0) {
								setFiles(resultFiles)
							}
							if (outputsLength === 1 && outputs) {
								setText(Object.values(outputs)[0] as string)
							}
							setWorkflowStatus('finished')
						} else if (
							parsedData.event === EventEnum.WORKFLOW_NODE_STARTED &&
							parsedData.data &&
							typeof (parsedData.data as { id?: string; node_type?: string; title?: string }).id ===
								'string' &&
							typeof (parsedData.data as { node_type?: string }).node_type === 'string' &&
							typeof (parsedData.data as { title?: string }).title === 'string'
						) {
							const nodeData = parsedData.data as { id: string; node_type: string; title: string }
							setWorkflowItems(prev => [
								...prev,
								{
									id: nodeData.id,
									status: 'running',
									type: nodeData.node_type,
									title: nodeData.title,
								} as IWorkflowNode,
							])
						} else if (
							parsedData.event === EventEnum.WORKFLOW_NODE_FINISHED &&
							parsedData.data &&
							typeof (parsedData.data as { id?: string }).id === 'string'
						) {
							const nodeData = parsedData.data as {
								id: string
								inputs?: unknown
								outputs?: unknown
								process_data?: unknown
								elapsed_time?: unknown
								execution_metadata?: unknown
							}
							setWorkflowItems(prev =>
								prev.map(item => {
									if (item.id === nodeData.id) {
										return {
											...item,
											status: 'success',
											inputs:
												typeof nodeData.inputs === 'string'
													? nodeData.inputs
													: JSON.stringify(nodeData.inputs ?? ''),
											outputs: nodeData.outputs,
											process_data:
												typeof nodeData.process_data === 'string'
													? nodeData.process_data
													: JSON.stringify(nodeData.process_data ?? ''),
											elapsed_time:
												typeof nodeData.elapsed_time === 'number'
													? nodeData.elapsed_time
													: Number(nodeData.elapsed_time ?? 0),
											execution_metadata:
												typeof nodeData.execution_metadata === 'object' &&
												nodeData.execution_metadata !== null
													? (nodeData.execution_metadata as {
															total_tokens: number
															total_price: number
															currency: string
														})
													: { total_tokens: 0, total_price: 0, currency: '' },
										}
									}
									return item
								}),
							)
						}
						if (parsedData.event === EventEnum.MESSAGE_FILE) {
							result += `<img src=""${parsedData.url} />`
						}
						if (parsedData.event === EventEnum.MESSAGE) {
							const text = parsedData.answer
							setText(prev => {
								return prev + text
							})
							result += text
						}
						if (parsedData.event === EventEnum.ERROR) {
							message.error((parsedData as unknown as IErrorEvent).message)
						}
						console.log('result', result)
					}
				}
			})
			.catch(err => {
				console.log('runWorkflow err', err)
				setWorkflowStatus(undefined)
			})
	}

	const resultDetailLength = Object.keys(resultDetail).length

	const resultItems = [
		{
			key: 'result',
			label: '结果' as React.ReactNode,
			children: (
				<div className="w-full h-full overflow-x-hidden overflow-y-auto">
					<MarkdownRenderer markdownText={text} />
				</div>
			),
			visible: resultDetailLength === 1,
		},
		files.length > 0
			? {
					key: 'files',
					label: '文件' as React.ReactNode,
					children: (
						<div className="w-full h-full overflow-x-hidden overflow-y-auto">
							<MessageFileList files={files as Partial<IMessageFileItem>[]} />
						</div>
					),
					visible: true,
				}
			: undefined,
		{
			key: 'detail',
			label: '详情' as React.ReactNode,
			children: (
				<div className="w-full">
					<LucideIcon
						className="cursor-pointer"
						name="copy"
						onClick={async () => {
							await copyToClipboard(JSON.stringify(resultDetail, null, 2))
							message.success('已复制到剪贴板')
						}}
					/>
					<pre className="w-full overflow-auto bg-theme-code-block-bg p-3 box-border rounded-lg">
						{JSON.stringify(resultDetail, null, 2)}
					</pre>
				</div>
			),
			visible: resultDetailLength > 0,
		},
	].filter(
		(
			item,
		): item is {
			key: string
			label: React.ReactNode
			children: React.ReactElement
			visible: boolean
		} => !!item && item.visible && !!item.children,
	)

	return (
		<div className="block md:flex md:items-stretch w-full h-full overflow-y-auto md:overflow-y-hidden bg-gray-50">
			{/* 参数填写区域 */}
			<div className="md:flex-1 overflow-hidden border-0 border-r border-solid border-light-gray bg-theme-bg pb-6 md:pb-0">
				<div className="px-2">
					<AppInfo />
				</div>
				<div className="px-6 mt-6">
					<AppInputForm
						onStartConversation={values => {
							console.log('onStartConversation', values)
						}}
						formFilled={false}
						entryForm={entryForm}
						uploadFileApi={difyApi.uploadFile}
					/>
				</div>
				<div className="flex justify-end px-6">
					<Button
						type="primary"
						onClick={async () => {
							await entryForm.validateFields()
							const values = await entryForm.getFieldsValue()
							setResultDetail({})
							setWorkflowItems([])
							setWorkflowStatus('running')
							setText('')
							handleTriggerWorkflow(values)
						}}
						loading={workflowStatus === 'running'}
					>
						运行
					</Button>
				</div>
			</div>

			{/* 工作流执行输出区域 */}
			<div className="md:flex-1 px-4 pt-6 overflow-x-hidden overflow-y-auto bg-gray-50">
				{!text && !workflowItems?.length && workflowStatus !== 'running' ? (
					<div className="w-full h-full flex items-center justify-center">
						<Empty description={`点击 "运行" 试试看, AI 会给你带来意想不到的惊喜。 `} />
					</div>
				) : (
					<>
						<WorkflowLogs
							className="mt-0"
							status={workflowStatus}
							items={workflowItems}
						/>
						{resultItems.length ? <Tabs items={resultItems} /> : null}
					</>
				)}
			</div>
		</div>
	)
}
